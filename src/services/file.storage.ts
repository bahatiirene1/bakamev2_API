/**
 * Supabase Storage Adapter
 * Implementation of FileServiceStorage interface for Supabase Storage
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { FileServiceStorage } from './file.service.js';

const BUCKET_NAME = 'uploads';
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Create Supabase Storage adapter
 */
export function createSupabaseStorageAdapter(
  supabase: SupabaseClient
): FileServiceStorage {
  return {
    /**
     * Generate a signed URL for uploading a file
     */
    async generateUploadUrl(
      storagePath: string,
      _mimeType: string
    ): Promise<{ url: string; expiresAt: Date }> {
      // For Supabase Storage, we use createSignedUploadUrl
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUploadUrl(storagePath);

      if (error) {
        throw new Error(`Failed to generate upload URL: ${error.message}`);
      }

      if (data === null) {
        throw new Error('No data returned from createSignedUploadUrl');
      }

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + SIGNED_URL_EXPIRY_SECONDS);

      return {
        url: data.signedUrl,
        expiresAt,
      };
    },

    /**
     * Generate a signed URL for downloading a file
     */
    async generateDownloadUrl(
      storagePath: string
    ): Promise<{ url: string; expiresAt: Date }> {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

      if (error) {
        throw new Error(`Failed to generate download URL: ${error.message}`);
      }

      if (data === null) {
        throw new Error('No data returned from createSignedUrl');
      }

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + SIGNED_URL_EXPIRY_SECONDS);

      return {
        url: data.signedUrl,
        expiresAt,
      };
    },

    /**
     * Delete a file from storage
     */
    async deleteObject(storagePath: string): Promise<void> {
      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([storagePath]);

      if (error) {
        throw new Error(`Failed to delete file: ${error.message}`);
      }
    },
  };
}

/**
 * Direct upload to Supabase Storage (for server-side uploads)
 * Used when parsing uploaded files on the server
 */
export async function uploadFileToStorage(
  supabase: SupabaseClient,
  storagePath: string,
  file: Buffer | Blob,
  mimeType: string
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Download file from Supabase Storage
 */
export async function downloadFileFromStorage(
  supabase: SupabaseClient,
  storagePath: string
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  if (data === null) {
    throw new Error('No data returned from download');
  }

  return data;
}
