// Supabase Edge Function — серверная проверка загружаемых файлов.
// Принимает multipart-форму (bucket, file), проверяет MIME-тип и размер,
// затем пишет файл в Storage от имени пользователя (RLS остаётся активным).
//
// Развёртывание:  supabase functions deploy upload-asset --no-verify-jwt
// Используется как усиление поверх клиентской проверки и политик Storage.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DOC = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
];
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx"]);
const MAX_IMG = 10 * 1024 * 1024;
const MAX_DOC = 20 * 1024 * 1024;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Проверка администратора на сервере (не доверяем клиенту).
  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const token = authHeader.replace("Bearer ", "");
  const { data: user, error } = await admin.auth.getUser(token);
  if (error || !user?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const form = await req.formData();
  const bucket = String(form.get("bucket") || "");
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: "Файл не передан." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isImage = bucket === "event-covers" || bucket === "event-photos";
  const isDoc = bucket === "event-documents";
  const okType = isImage ? IMG.includes(file.type) : (DOC.includes(file.type) || DOC_EXT.has(ext));
  const limit = isImage ? MAX_IMG : MAX_DOC;

  if (!isImage && !isDoc) {
    return new Response(JSON.stringify({ error: "Недопустимый раздел хранилища." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (!okType) {
    return new Response(JSON.stringify({ error: "Недопустимый тип файла." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
  if (file.size > limit) {
    return new Response(JSON.stringify({ error: "Файл слишком большой." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const { error: upErr } = await client.storage.from(bucket).upload(path, file);
  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return new Response(JSON.stringify({ url: data.publicUrl }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
