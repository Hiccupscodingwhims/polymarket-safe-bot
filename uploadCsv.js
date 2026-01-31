import fs from "fs";
import { supabase } from "./supabaseClient.js";

export async function uploadCsv(localPath, remotePath) {
  const fileBuffer = fs.readFileSync(localPath);

  const { error } = await supabase.storage
    .from("paper-tester-results")
    .upload(remotePath, fileBuffer, {
      upsert: true,
      contentType: "text/csv"
    });

  if (error) {
    console.error("❌ Supabase upload failed:", error.message);
  } else {
    console.log(`☁️ Uploaded → ${remotePath}`);
  }
}
