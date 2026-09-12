(function () {
  "use strict";

  const supabase = () =>
    window.PulseOpsSupabase &&
    window.PulseOpsSupabase.client;

  let authSubscription = null;

  function requireClient() {
    const client = supabase();

    if (!client) {
      throw new Error("Supabase is not configured.");
    }

    return client;
  }

  // =========================================================
  // SESSION
  // =========================================================

  async function getSession() {
    const client = supabase();

    if (!client) {
      return {
        session: null,
        error: null
      };
    }

    const { data, error } =
      await client.auth.getSession();

    return {
      session: data?.session || null,
      error: error || null
    };
  }

  async function getUser() {
    const client = requireClient();

    const { data, error } =
      await client.auth.getUser();

    if (error) {
      console.error(
        "[PulseOps Auth] getUser failed:",
        {
          message: error.message,
          code: error.code,
          status: error.status
        }
      );

      throw error;
    }

    return data?.user || null;
  }

  // =========================================================
  // LOGIN
  // =========================================================

  async function signIn(email, password) {
    const client = requireClient();

    const normalizedEmail =
      String(email || "")
        .trim()
        .toLowerCase();

    const normalizedPassword =
      String(password || "");

    console.log(
      "[PulseOps Auth] Attempting sign in for:",
      normalizedEmail
    );

    const { data, error } =
      await client.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword
      });

    if (error) {
      console.error(
        "[PulseOps Auth] Supabase sign-in failed:",
        {
          message: error.message,
          code: error.code,
          status: error.status
        }
      );

      throw error;
    }

    if (!data?.session || !data?.user) {
      throw new Error(
        "Supabase accepted the request but did not return an authenticated session."
      );
    }

    console.log(
      "[PulseOps Auth] Supabase authentication successful:",
      data.user.id
    );

    return data;
  }

  // =========================================================
  // LOGOUT
  // =========================================================

  async function signOut() {
    const client = supabase();

    if (!client) return;

    const { error } =
      await client.auth.signOut();

    if (error) {
      console.error(
        "[PulseOps Auth] Sign out failed:",
        error
      );

      throw error;
    }
  }

  // =========================================================
  // PASSWORD RECOVERY
  // =========================================================

  function recoveryRedirectUrl() {
    /*
     * Password recovery uses a dedicated page.
     *
     * This avoids Supabase recovery parameters interfering
     * with the PulseOps hash router.
     */

    return new URL(
      "reset-password.html",
      window.location.href
    ).toString();
  }

  async function resetPassword(email) {
    const client = requireClient();

    const normalizedEmail =
      String(email || "")
        .trim()
        .toLowerCase();

    const { error } =
      await client.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo:
            recoveryRedirectUrl()
        }
      );

    if (error) {
      console.error(
        "[PulseOps Auth] Password reset request failed:",
        {
          message: error.message,
          code: error.code,
          status: error.status
        }
      );

      throw error;
    }
  }

  async function updatePassword(password) {
    const client = requireClient();

    const nextPassword =
      String(password || "");

    if (nextPassword.length < 8) {
      throw new Error(
        "Password must be at least 8 characters."
      );
    }

    /*
     * updateUser() requires an authenticated recovery session.
     *
     * Check that explicitly before trying to update.
     */

    const {
      data: sessionData,
      error: sessionError
    } =
      await client.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!sessionData?.session?.user) {
      const error =
        new Error(
          "This password reset link is no longer valid. Request a new reset email."
        );

      error.code =
        "recovery_session_missing";

      throw error;
    }

    const { data, error } =
      await client.auth.updateUser({
        password: nextPassword
      });

    if (error) {
      console.error(
        "[PulseOps Auth] Password update failed:",
        {
          message: error.message,
          code: error.code,
          status: error.status
        }
      );

      throw error;
    }

    return data;
  }

  // =========================================================
  // PULSEOPS PROFILE
  // =========================================================

  async function loadProfile() {
    const client =
      requireClient();

    /*
     * First confirm which Supabase Auth user
     * is currently signed in.
     */

    const {
      data: userData,
      error: userError
    } =
      await client.auth.getUser();

    if (userError) {
      console.error(
        "[PulseOps Auth] Could not obtain authenticated user:",
        {
          message: userError.message,
          code: userError.code,
          status: userError.status
        }
      );

      throw userError;
    }

    const user =
      userData?.user;

    if (!user) {
      console.warn(
        "[PulseOps Auth] No authenticated Supabase user exists."
      );

      return null;
    }

    console.log(
      "[PulseOps Auth] Loading PulseOps profile:",
      user.id
    );

    /*
     * IMPORTANT
     * =====================================================
     *
     * DO NOT JOIN TEAMS IN THIS QUERY.
     *
     * PulseOps has two relationships involving:
     *
     * profiles
     * teams
     *
     * profiles.team_id -> teams.id
     * teams.lead_id    -> profiles.id
     *
     * This can make an embedded PostgREST relationship
     * ambiguous.
     *
     * So profile and team are loaded separately.
     */

    const {
      data: profile,
      error: profileError
    } =
      await client
        .from("profiles")
        .select(`
          id,
          organization_id,
          email,
          full_name,
          role,
          status,
          avatar_url,
          last_active_at,
          team_id
        `)
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    if (profileError) {
      console.error(
        "[PulseOps Auth] Profile query failed:",
        {
          message:
            profileError.message,

          code:
            profileError.code,

          details:
            profileError.details,

          hint:
            profileError.hint
        }
      );

      throw profileError;
    }

    if (!profile) {
      console.error(
        "[PulseOps Auth] Authentication succeeded but the profiles row is missing."
      );

      return null;
    }

    /*
     * Some older profiles may not have email populated.
     * Supabase Auth remains the authority for login email.
     */

    if (!profile.email) {
      profile.email =
        user.email || "";
    }

    /*
     * Team is optional.
     *
     * Your administrator account currently has:
     *
     * team_id = NULL
     *
     * THAT IS VALID.
     *
     * It must never prevent login.
     */

    profile.team = null;

    if (profile.team_id) {
      try {
        const {
          data: team,
          error: teamError
        } =
          await client
            .from("teams")
            .select(
              "id, name"
            )
            .eq(
              "id",
              profile.team_id
            )
            .maybeSingle();

        if (teamError) {
          /*
           * Team information is supplementary.
           *
           * Login MUST continue.
           */

          console.warn(
            "[PulseOps Auth] Team lookup failed. Login will continue:",
            {
              message:
                teamError.message,

              code:
                teamError.code,

              details:
                teamError.details,

              hint:
                teamError.hint
            }
          );
        } else {
          profile.team =
            team || null;
        }
      } catch (error) {
        console.warn(
          "[PulseOps Auth] Team lookup exception. Login will continue:",
          error
        );
      }
    }

    /*
     * Updating last_active_at is also best-effort.
     *
     * Presence tracking must NEVER block login.
     */

    try {
      const { error } =
        await client
          .from("profiles")
          .update({
            last_active_at:
              new Date()
                .toISOString()
          })
          .eq(
            "id",
            user.id
          );

      if (error) {
        console.warn(
          "[PulseOps Auth] last_active_at update skipped:",
          {
            message:
              error.message,

            code:
              error.code
          }
        );
      }
    } catch (error) {
      console.warn(
        "[PulseOps Auth] Presence update exception:",
        error
      );
    }

    console.log(
      "[PulseOps Auth] Profile loaded successfully:",
      {
        id:
          profile.id,

        role:
          profile.role,

        status:
          profile.status,

        organization_id:
          profile.organization_id,

        team_id:
          profile.team_id
      }
    );

    return profile;
  }

  // =========================================================
  // AUTH STATE LISTENER
  // =========================================================

  function onAuthStateChange(callback) {
    const client =
      requireClient();

    /*
     * Only ONE Supabase auth listener should exist.
     */

    if (authSubscription) {
      try {
        authSubscription
          .unsubscribe();
      } catch (_) {}

      authSubscription = null;
    }

    const { data } =
      client.auth
        .onAuthStateChange(
          (
            event,
            session
          ) => {
            console.log(
              "[PulseOps Auth] State changed:",
              event
            );

            callback(
              event,
              session
            );
          }
        );

    authSubscription =
      data?.subscription ||
      null;

    return authSubscription;
  }

  function stopAuthListener() {
    if (authSubscription) {
      try {
        authSubscription
          .unsubscribe();
      } catch (_) {}
    }

    authSubscription = null;
  }

  // =========================================================
  // EXPORT
  // =========================================================

  window.PulseOpsAuth = {
    getSession,
    getUser,

    signIn,
    signOut,

    resetPassword,
    updatePassword,

    loadProfile,

    onAuthStateChange,
    stopAuthListener,

    recoveryRedirectUrl
  };

})();