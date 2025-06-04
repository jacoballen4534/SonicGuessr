// /var/www/sonicguessr-api/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "sonicguessr-api",
    script : "server.js",
    env_production: {
       NODE_ENV: "production",
       // You can define other env vars here if not using .env, but .env is good
    }
  }]
}
