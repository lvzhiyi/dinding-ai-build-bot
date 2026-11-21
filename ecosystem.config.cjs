// pm2 启动配置：pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'dingtalk-build-bridge',
      script: 'src/index.js',
      node_args: '--env-file-if-exists=.env',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
