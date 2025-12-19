// Debug endpoint to test imports
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Check environment variables
    const envCheck = {
      SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'MISSING',
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
        ? 'SET'
        : 'MISSING',
    };

    // Try to import and initialize step by step
    let steps: Record<string, string> = {};

    // Step 1: Import handle
    try {
      const { handle } = await import('@hono/node-server/vercel');
      steps['import_handle'] = 'OK';
    } catch (e: any) {
      steps['import_handle'] = `FAIL: ${e.message}`;
    }

    // Step 2: Import createClient
    try {
      const { createClient } = await import('@supabase/supabase-js');
      steps['import_supabase'] = 'OK';
    } catch (e: any) {
      steps['import_supabase'] = `FAIL: ${e.message}`;
    }

    // Step 3: Import createApp
    try {
      const { createApp } = await import('../dist/api/app.js');
      steps['import_createApp'] = 'OK';
    } catch (e: any) {
      steps['import_createApp'] = `FAIL: ${e.message}`;
    }

    // Step 4: Import services
    try {
      const services = await import('../dist/services/index.js');
      steps['import_services'] = 'OK';
      steps['services_exports'] = Object.keys(services).join(', ');
    } catch (e: any) {
      steps['import_services'] = `FAIL: ${e.message}`;
    }

    // Step 5: Try to create Supabase client
    try {
      const { createClient } = await import('@supabase/supabase-js');
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_KEY
        );
        steps['create_supabase'] = 'OK';
      } else {
        steps['create_supabase'] = 'SKIP - missing env vars';
      }
    } catch (e: any) {
      steps['create_supabase'] = `FAIL: ${e.message}`;
    }

    res.status(200).json({
      envCheck,
      steps,
      nodeVersion: process.version,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
