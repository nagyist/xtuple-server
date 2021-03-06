var lib = require('xtuple-server-lib'),
  mkdirp = require('mkdirp'),
  _ = require('lodash'),
  n = require('n-api'),
  rimraf = require('rimraf'),
  proc = require('child_process'),
  fs = require('fs'),
  path = require('path');

var xtInstall = _.extend(exports, lib.task, /** @exports xtuple-server-xt-install */ {

  options: {
    ghuser: {
      optional: '[ghuser]',
      description: 'Github Account username',
      validate: function (value, options) {
        if (!_.isEmpty(value) && _.isEmpty(options.xt.ghpass)) {
          throw new Error('cannot use xt-ghuser without xt-ghpass');
        }
        return (value || '').trim();
      }
    },
    ghpass: {
      optional: '[ghpass]',
      description: 'Github Account password',
      validate: function (value, options) {
        if (!_.isEmpty(value) && _.isEmpty(options.xt.ghuser)) {
          throw new Error('cannot use xt-ghpass without xt-ghuser');
        }
        return (value || '').trim();
      }
    }
  },

  /** @override */
  beforeTask: function (options) {
    // add github.com to known_hosts file to avoid host authenticity prompt
    if (process.env.CI) {
      try {
        proc.spawnSync('ssh', [ '-o', 'StrictHostKeyChecking=no', 'git@github.com' ], { stdio: 'ignore' });
      }
      catch (e) {
        log.silly('xt-install', e.stack.split('\n'));
      }
    }

    if (fs.existsSync(options.xt.coredir)) {
      lib.util.resolveNodeVersion(options);
    }
  },

  /** @override */
  executeTask: function (options) {
    var latest = path.resolve(__dirname, 'node_modules', 'node-latest-version', 'index.js');
    var protocol = process.env.CI ? 'git@github.com:' : 'https://github.com/';

    if (options.planName === 'install-dev') {
      log.info('xt-install', 'local-workspace expected to already be npm-installed. skipping');
      return;
    }

    // FIXME this needs to be validated more thoroughly
    if (!_.isEmpty(options.xt.ghuser) && !_.isEmpty(options.xt.ghpass)) {
      protocol = 'https://' + options.xt.ghuser + ':' + options.xt.ghpass + '@github.com/';
    }

    _.each(lib.util.getRepositoryList(options), function (repo) {
      var clonePath = path.resolve(options.xt.dist, repo),
        deployPath = path.resolve(options.xt.userdist, repo);

      // FIXME all this stuff should be done through npm
      log.http('xt-install', 'downloading', repo, options.xt.gitVersion);
      if (!fs.existsSync(path.resolve(clonePath, 'node_modules'))) {
        rimraf.sync(clonePath);

        proc.execSync([ 'git clone --recursive', protocol + 'xtuple/' + repo + '.git', clonePath].join(' '), {
          cwd: clonePath, stdio: 'ignore'
        });
        proc.execSync('cd '+ clonePath +' && git checkout ' + options.xt.gitVersion, { cwd: clonePath, stdio: 'ignore' });
        proc.execSync('cd '+ clonePath +' && git submodule update --init');
      }

      if (_.isEmpty(options.xt.nodeVersion)) {
        lib.util.resolveNodeVersion(options, clonePath);
        n(options.xt.nodeVersion);
      }

      // npm install no matter what. this way, partial npm installs are always
      // recoverable without manual intervention
      log.http('xt-install', 'installing npm module...');
      proc.execSync([ 'cd', clonePath, '&& npm install --unsafe-perm' ].join(' '), { cwd: clonePath });

      if (!fs.existsSync(deployPath)) {

        log.info('xt-install', 'copying files...');
        if (!fs.existsSync(deployPath)) {
          mkdirp.sync(deployPath);
        }
        // copy main repo files to user's home directory
        var rsync = proc.execSync([ 'rsync -ar --exclude=.git', clonePath + '/*', deployPath ].join(' '));
          
        proc.execSync([ 'chown -R', options.xt.name, deployPath ].join(' '));
        proc.execSync('chmod -R u=rwx ' + deployPath);
      }
    });
  },

  /** @override */
  afterTask: function (options) {
    proc.spawnSync([ 'chown -R', options.xt.name + ':' + options.xt.name, options.xt.userhome ]);
    n(process.version);
  }
});
