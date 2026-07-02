'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const compression = require('compression');

const config = require('./config');
const { migrate } = require('./db');
const { seedPools } = require('./db/seed');

const helmetMw = require('./security/helmet');
const csrf = require('./security/csrf');
const { globalLimiter } = require('./security/rateLimit');
const { SqliteStore } = require('./security/sessionStore');
const { attachUser } = require('./security/auth');

const money = require('./utils/money');
const timeUtil = require('./utils/time');

function createApp() {
  migrate();
  seedPools();

  const app = express();
  const sessionStore = new SqliteStore();
  app.set('sessionStore', sessionStore);

  // Behind the demo/proxy, trust the first proxy hop for secure cookies + IPs.
  app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(compression());
  app.use(helmetMw);
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      maxAge: config.isProd ? '7d' : 0,
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use(
    session({
      name: config.session.cookieName,
      secret: config.session.secret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd, // HTTPS-only cookies in production
        maxAge: config.session.maxAgeMs,
      },
    }),
  );

  // Capture request meta so the session store can persist IP + UA.
  app.use((req, res, next) => {
    if (req.session) {
      req.session.meta = {
        ip: req.ip,
        userAgent: (req.get('user-agent') || '').slice(0, 300),
      };
    }
    next();
  });

  // Identify the user and populate template locals BEFORE the rate limiter and
  // CSRF middleware, so any error page those render has brand/flash/user in scope.
  app.use(attachUser);

  // Shared template locals.
  app.use((req, res, next) => {
    res.locals.brand = config.brand;
    res.locals.terms = config.terms;
    res.locals.money = money;
    res.locals.time = timeUtil;
    res.locals.path = req.path;
    res.locals.year = new Date().getFullYear();
    res.locals.title = config.brand.name;
    next();
  });

  // Flash messages (one-shot, session-backed).
  app.use((req, res, next) => {
    res.locals.flash = (req.session && req.session.flash) || [];
    if (req.session) req.session.flash = [];
    req.flash = (type, message) => {
      if (!req.session) return;
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type, message });
    };
    next();
  });

  app.use(globalLimiter);
  app.use(csrf.middleware);

  // Routes
  app.use('/', require('./routes/marketing'));
  app.use('/', require('./routes/auth'));
  app.use('/portal', require('./routes/portal'));
  app.use('/api', require('./routes/api'));

  // 404
  app.use((req, res) => {
    res.status(404).render('errors/404', { title: 'Page not found' });
  });

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).render('errors/500', {
      title: 'Something went wrong',
      message: config.isProd ? 'An unexpected error occurred.' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
