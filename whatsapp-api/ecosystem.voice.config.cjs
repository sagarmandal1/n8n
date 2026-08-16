module.exports = {
  apps: [
    {
      name: "whatsapp-voice",
      cwd: "/var/www/whatsapp-api",
      script: "lib/signcopy/voice_service.py",
      interpreter: "/var/www/whatsapp-api/.venv-voice/bin/python",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "15s",
      restart_delay: 3000,
      env: {
        LOCAL_WHISPER_MODEL: "base",
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
