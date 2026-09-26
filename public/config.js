// Public configuration only. Never put secret keys here: Paystack, Brevo, SMS and the Firebase
// service account live in Cloudflare Worker secrets.
window.MEMORIES_CONFIG = {
  // The Worker (worker/wrangler.toml → name). Same host the Paystack webhook points at.
  apiBase: 'https://memories-paystack-verify.diamondj04102026.workers.dev',
  // Firebase web config: used by the staff pages only (sign-in, flyer uploads).
  firebase: {
    apiKey: 'AIzaSyCkhFjqfTqCIg9ic5Qh63XfWVT4tGWuzpM',
    authDomain: 'memoriesnightclub-2717f.firebaseapp.com',
    projectId: 'memoriesnightclub-2717f',
    storageBucket: 'memoriesnightclub-2717f.firebasestorage.app',
    messagingSenderId: '143491627943',
    appId: '1:143491627943:web:7cb70bfabdefda7e8a5482',
  },
};
