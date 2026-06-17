// PM2 process config. Start with:  pm2 start ecosystem.config.js
// NOTE: keep instances = 1 (fork mode). This app uses an in-memory session
// store, so running multiple clustered instances would break login sessions.
module.exports = {
  apps: [
    {
      name: "wc2026-predictor",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
