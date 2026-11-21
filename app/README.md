# app/

The Next.js application. Run it from this directory:

```bash
npm install
npm run dev
```

Setup, prerequisites and the API keys it needs are in the [root README](../README.md).

Note: this app will not run on Vercel or any serverless host. It shells out to ffmpeg,
writes to the local filesystem and has routes with 15-minute timeouts. The root README
explains the layout it expects.
