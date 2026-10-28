// PM2 keeps your Node.js process alive permanently.
// If the server crashes or reboots, PM2 restarts the app automatically.
//
// SETUP:
//   npm install -g pm2
//   pm2 start ecosystem.config.js --env production
//   pm2 save                    # save process list
//   pm2 startup                 # generate systemd startup script
//   sudo <the command it prints>  # enable on system boot
//
// USEFUL COMMANDS:
//   pm2 status                  # see if app is running
//   pm2 logs patient-system     # live log tail
//   pm2 restart patient-system  # restart after code changes
//   pm2 monit                   # real-time CPU/memory dashboard

module.exports = {
  apps: [
    {
      name:         'patient-system',
      script:       'server.secure.js',

      // Run one process per CPU core for maximum throughput.
      // On a 2-core clinic server this runs 2 Node.js processes.
      instances:    'max',
      exec_mode:    'cluster',

      // Restart if memory exceeds 512MB (prevents memory leaks crashing server)
      max_memory_restart: '512M',

      // Wait 5 seconds before restarting after a crash
      restart_delay: 5000,

      // Environment variables for production
      env_production: {
        NODE_ENV:      'production',
        PORT:           3000,
        // All other secrets come from the .env file — never hardcode them here
      },

      // Environment variables for development
      env_development: {
        NODE_ENV: 'development',
        PORT:      3000,
      },

      // Log files (PM2 also captures stdout/stderr)
      out_file:  './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Watch for file changes in development (disable in production)
      watch:  false,
      ignore_watch: ['node_modules', 'logs'],
    },
  ],
};
