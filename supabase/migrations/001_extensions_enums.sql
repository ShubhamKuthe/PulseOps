-- PulseOps migration 001: extensions and enums

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('employee', 'engineer', 'manager', 'administrator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_priority as enum ('p1', 'p2', 'p3', 'p4');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_status as enum ('open', 'acknowledged', 'investigating', 'in_progress', 'waiting', 'monitoring', 'resolved', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.service_health as enum ('operational', 'degraded', 'partial_outage', 'major_incident');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.environment_type as enum ('production', 'staging', 'development', 'saas');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.comment_visibility as enum ('public', 'internal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum ('incident', 'assignment', 'sla_warning', 'comment', 'resolved', 'system');
exception when duplicate_object then null; end $$;
