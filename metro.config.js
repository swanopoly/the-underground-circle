// metro.config.js — Customize Metro bundler for The Underground Circle

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Customize the web HTML template to prevent white flash on load
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      // Intercept the root HTML response and inject dark background
      if (req.url === '/' || req.url === '/index.html') {
        const originalEnd = res.end;
        let body = '';
        const originalWrite = res.write;

        res.write = function(chunk) {
          body += chunk.toString();
          return true;
        };

        res.end = function(chunk) {
          if (chunk) body += chunk.toString();

          // Inject dark background CSS into <head>
          if (body.includes('<head>') || body.includes('<head ')) {
            body = body.replace(
              /<head([^>]*)>/,
              `<head$1><style>html,body,#root{background-color:#000!important;margin:0;padding:0;min-height:100vh}body{color:#f0f0f5}</style>`
            );
          }

          // Also set style on html and body tags
          body = body.replace('<html ', '<html style="background:#000" ');
          body = body.replace('<body>', '<body style="background:#000;margin:0">');

          originalEnd.call(res, body);
        };
      }

      return middleware(req, res, next);
    };
  },
};

module.exports = config;
