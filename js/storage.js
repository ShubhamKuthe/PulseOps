(function () {
  "use strict";

  const BUCKET = "incident-attachments";
  const MAX_BYTES = 10 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "pdf", "txt", "log"]);
  const supabase = () => window.PulseOpsSupabase && window.PulseOpsSupabase.client;

  function requireClient() {
    const client = supabase();
    if (!client) throw new Error("Supabase is not configured.");
    return client;
  }

  function validateFile(file) {
    if (!file) throw new Error("Choose a file to upload.");
    if (file.size > MAX_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("Allowed attachment types: PNG, JPG, WEBP, PDF, TXT, and LOG.");
    }
  }

  async function uploadIncidentAttachment(organizationId, incidentId, file) {
    validateFile(file);
    const client = requireClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const randomId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const storagePath = `${organizationId}/${incidentId}/${randomId}-${safeName}`;

    const { data: upload, error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const { data: metadata, error: metadataError } = await client
      .from("incident_attachments")
      .insert({
        incident_id: incidentId,
        storage_path: upload.path,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size
      })
      .select("id, incident_id, storage_path, file_name, mime_type, size_bytes, created_at, uploaded_by, uploader:profiles!incident_attachments_uploaded_by_fkey(id, full_name)")
      .single();

    if (metadataError) {
      await client.storage.from(BUCKET).remove([upload.path]).catch(() => {});
      throw metadataError;
    }
    return metadata;
  }

  async function createSignedAttachmentUrl(storagePath, download) {
    const client = requireClient();
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 300, download ? { download: true } : undefined);
    if (error) throw error;
    return data.signedUrl;
  }

  async function deleteIncidentAttachment(attachment) {
    const client = requireClient();
    if (!attachment || !attachment.id || !attachment.storage_path) throw new Error("Invalid attachment.");
    // Remove the database reference first. The Storage delete policy is based
    // on the incident UUID encoded in the path, so it remains authorized.
    // If object cleanup fails, the UI will not retain a broken metadata row.
    const { error: metadataError } = await client.from("incident_attachments").delete().eq("id", attachment.id);
    if (metadataError) throw metadataError;
    const { error: storageError } = await client.storage.from(BUCKET).remove([attachment.storage_path]);
    if (storageError) {
      console.warn("Attachment metadata deleted but Storage cleanup failed", storageError);
      throw storageError;
    }
  }

  window.PulseOpsStorage = {
    BUCKET,
    MAX_BYTES,
    validateFile,
    uploadIncidentAttachment,
    createSignedAttachmentUrl,
    deleteIncidentAttachment
  };
})();
