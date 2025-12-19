// Debug endpoint to test imports
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Try to import from dist
    const fs = await import('fs');
    const path = await import('path');

    // Check what's in the file system
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd);

    // Check if dist exists
    const distPath = path.join(cwd, 'dist');
    let distFiles: string[] = [];
    let distExists = false;

    try {
      distExists = fs.existsSync(distPath);
      if (distExists) {
        distFiles = fs.readdirSync(distPath);
      }
    } catch (e) {
      // ignore
    }

    // Try to import the app
    let appImportError = null;
    try {
      const app = await import('../dist/api/app.js');
    } catch (e: any) {
      appImportError = e.message;
    }

    res.status(200).json({
      cwd,
      files,
      distExists,
      distFiles,
      appImportError,
      nodeVersion: process.version,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
