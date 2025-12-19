// Simple test endpoint to verify serverless works
export default function handler(req: any, res: any) {
  res.status(200).json({ status: 'ok', message: 'API is working!' });
}
