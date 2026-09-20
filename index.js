// Basic Imports
const config = require("./config.json");
const express = require("express");
const app = express();
const chalk = require('chalk');
const bcrypt = require('bcrypt');
const utils = require('hyperz-utils');
const fs = require('node:fs');
const getSize = require('get-folder-size');

// MySQL Setup
const mysql = require('mysql');
config.sql.charset = "utf8mb4";
let con = mysql.createConnection(config.sql); // set = 0 to disable

// Backend Initialization
const backend = require('./backend.js');
backend.init(app, con);

// Discord Login Passport
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const DiscordStrategy = require('passport-discord-hyperz').Strategy;
passport.serializeUser(function(user, done) { done(null, user) });
passport.deserializeUser(function(obj, done) { done(null, obj) });
if(config.loginMethods.usePassport) {
    passport.use(new LocalStrategy({ usernameField: 'email' }, backend.authenticateUserLocal))
};
if(config.loginMethods.useDiscord) {
    passport.use(new DiscordStrategy({
        clientID: config.loginMethods.discordOAuthId,
        clientSecret: config.loginMethods.discordOAuthSecret,
        callbackURL: `${config.domain}/auth/discord/callback`,
        scope: ['identify', 'guilds', 'email'],
        prompt: 'consent'
    }, function(accessToken, refreshToken, profile, done) {
        process.nextTick(function() {
            return done(null, profile);
        });
    }));
};

// Routing
app.get('', function(req, res) {
    backend.refreshAppLocals(app);
    let data = {};
    con.query(`SELECT * FROM users`, function(err, row) {
        if(err) throw err;
        data.users = row.length;
        con.query(`SELECT * FROM uploads`, function(err, row) {
            if(err) throw err;
            data.uploads = row.length;
            con.query(`SELECT * FROM staff`, function(err, row) {
                if(err) throw err;
                data.staff = row.length;
                res.render('index.ejs', { loggedIn: req.isAuthenticated(), data: data });
            });
        });
    });
});

app.get('/panel', backend.checkAuth, function(req, res) {
    backend.refreshAppLocals(app);
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, function(err, row) {
        if(err) throw err;
        let isStaff = false;
        if(row[0]) isStaff = true;
        con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async (err, row) => {
            if(err) throw err;
            if(!row[0]) res.redirect('/login');
            if(!fs.existsSync(`./public/u/${row[0].folder}`)) {
                fs.mkdirSync(`./public/u/${row[0].folder}`);
            };
            let user = row[0];
            con.query(`SELECT * FROM uploads WHERE userid="${req.user.id}"`, async (err, row) => {
                if(err) throw err;
                let uploads = row;
                getSize(`./public/u/${user.folder}`, async function(err, size) {
                    if (err) throw err;  
                    let mbSize = (size / 1024 / 1024).toFixed(2);
                    res.render('panel.ejs', { loggedIn: true, isStaff: isStaff, user: user, uploads: uploads, mbSize: mbSize, percentage: backend.percentage(Number(mbSize), user.maxspace), currenttime: await utils.fetchTime(config.timeZone.tz, 'MM-DD-YYYY hh:mm A') }); 
                });
            });
        });
    });
});

app.get('/admin', backend.checkAuth, function(req, res) {
    backend.refreshAppLocals(app);
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, async (err, row) => {
        if(err) throw err;
        if(!row[0]) res.redirect('/panel');
        con.query(`SELECT * FROM sitesettings`, function(err, settings) {
            if(err) throw err;
            con.query(`SELECT * FROM users`, function(err, users) {
                if(err) throw err;
                con.query(`SELECT * FROM staff`, function(err, staff) {
                    if(err) throw err;
                    con.query(`SELECT * FROM uploads`, async (err, uploads) => {
                        if(err) throw err;
                        res.render('admin.ejs', { user: req.user, loggedIn: true, settings: settings[0], staff: staff, users: users, uploads: uploads, currenttime: await utils.fetchTime(config.timeZone.tz, 'MM-DD-YYYY hh:mm A') }); 
                    });
                });
            });
        });
    });
});

app.get('/cookies', function(req, res) {
    backend.refreshAppLocals(app);
    res.render('cookies.ejs', { loggedIn: req.isAuthenticated() });
});

app.get('/privacy', function(req, res) {
    backend.refreshAppLocals(app);
    res.render('privacy.ejs', { loggedIn: req.isAuthenticated() });
});

app.get('/login', backend.checkNotAuth, function(req, res) {
    backend.refreshAppLocals(app);
    res.render('login.ejs', { loggedIn: req.isAuthenticated() });
});

app.get('/register', backend.checkNotAuth, function(req, res) {
    backend.refreshAppLocals(app);
    res.render('register.ejs', { loggedIn: req.isAuthenticated() });
});

app.post('/upload', async function(req, res) {
    if(!req.headers.userid) return res.send({ status: 400, errormsg:'No userid provided in header request of ShareX!', url: 'ERROR: No userid provided in header request of ShareX!' });
    if(!req.headers.secret) return res.send({ status: 400, errormsg:'No secret provided in header request of ShareX!', url: 'ERROR: No secret provided in header request of ShareX!' });
    req.headers.userid = await utils.sanitize(req.headers.userid);
    req.headers.secret = await utils.sanitize(req.headers.secret);
    if(!req.files[0]) return res.send({ status: 400, errormsg:'No file was retrieved in the payload.', url: 'ERROR: No file was retrieved in the payload.' });
    let fileSizeMb = (req.files[0].size / 1024 / 1024).toFixed(2);
    con.query(`SELECT * FROM users WHERE secret="${req.headers.secret}" AND id="${req.headers.userid}"`, async (err, row) => {
        if(err) throw err;
        if(!row[0]) return res.send({ status: 401, errormsg:'Invalid userid or secret in request.', url: 'ERROR: Invalid userid or secret in request.' });
        if(!fs.existsSync(`./public/u/${row[0].folder}`)) {
            fs.mkdirSync(`./public/u/${row[0].folder}`);
        };
        getSize(`./public/u/${row[0].folder}`, async function(err, size) {
            if (err) throw err;  
            let mbSize = (size / 1024 / 1024).toFixed(2);
            if(row[0].maxspace < (Number(mbSize) + Number(fileSizeMb))) return res.send({ status: 403, errormsg:'Your max folder space is exceeding the limit.', url: 'ERROR: Your max folder space is exceeding the limit.' });
            let nameGen = await backend.makeId(config.fileNameLength);
            let fileExt = await req.files[0].originalname.split('.').reverse()[0];
            con.query(`INSERT INTO uploads (uniqueid, userid, fileid, filename, datetime) VALUES ("${await utils.generateRandom(26, false)}", "${req.headers.userid}", "${nameGen}", "${nameGen}.${fileExt}", "${await utils.fetchTime(config.timeZone.tz, config.timeZone.format)}")`, function(err, row) {
                if(err) throw err;
            });
            fs.writeFileSync(`./public/u/${row[0].folder}/${nameGen}.${fileExt}`, req.files[0].buffer);
            let json_ = {
                status: 200,
                errormsg: "",
                url: `${config.domain}/u/${row[0].folder}/${nameGen}.${fileExt}`
            };
            res.send(json_);
            backend.webhook(app, row[0], `${config.domain}/u/${row[0].folder}/${nameGen}.${fileExt}`);
        });
    });
});

app.post('/manualupload', backend.checkAuth, async function(req, res) {
    if(!req.files[0]) return res.redirect('/404');
    let fileSizeMb = (req.files[0].size / 1024 / 1024).toFixed(2);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async (err, row) => {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        if(!fs.existsSync(`./public/u/${row[0].folder}`)) {
            fs.mkdirSync(`./public/u/${row[0].folder}`);
        };
        getSize(`./public/u/${row[0].folder}`, async function(err, size) {
            if (err) throw err;  
            let mbSize = (size / 1024 / 1024).toFixed(2);
            if(row[0].maxspace < (Number(mbSize) + Number(fileSizeMb))) return res.send('ERROR: Your max folder space is exceeding the limit.');
            let nameGen = await backend.makeId(config.fileNameLength);
            let fileExt = await req.files[0].originalname.split('.').reverse()[0];
            con.query(`INSERT INTO uploads (uniqueid, userid, fileid, filename, datetime) VALUES ("${await utils.generateRandom(26, false)}", "${req.user.id}", "${nameGen}", "${nameGen}.${fileExt}", "${await utils.fetchTime(config.timeZone.tz, config.timeZone.format)}")`, function(err, row) {
                if(err) throw err;
            });
            fs.writeFileSync(`./public/u/${row[0].folder}/${nameGen}.${fileExt}`, req.files[0].buffer);
            res.redirect('/panel');
            backend.webhook(app, row[0], `${config.domain}/u/${row[0].folder}/${nameGen}.${fileExt}`);
        });
    });
});

app.get('/backend/getmyfile', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    con.query(`SELECT * FROM users WHERE id="${req?.user?.id}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        let configjson = {
            "Version": "14.1.0",
            "Name": "CDNSystem",
            "DestinationType": "ImageUploader, FileUploader",
            "RequestMethod": "POST",
            "RequestURL": `${config.domain}/upload`,
            "Headers": {
                "userid": row[0].id,
                "secret": row[0].secret
            },            
            "Body": "MultipartFormData",
            "FileFormName": "sharex",
            "URL": "{json:url}"
        };
        fs.writeFileSync(`./public/u/CDNSystem.sxcu`, JSON.stringify(configjson));
        res.download(`./public/u/CDNSystem.sxcu`, 'CDNSystem.sxcu')
        setTimeout(() => {
            fs.unlink('./public/u/CDNSystem.sxcu', function (err) {
                if (err) throw err;
            });    
        }, 5000);
    });
});

app.get('/backend/deletemyfolder', backend.checkAuth, function(req, res) {
    backend.refreshAppLocals(app);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        fs.readdirSync(`./public/u/${row[0].folder}`).forEach(function(item) {
            try { fs.unlinkSync(`./public/u/${row[0].folder}/${item}`) } catch(e) {};
        });
        con.query(`DELETE FROM uploads WHERE userid="${req.user.id}"`, function(err, row) { if(err) throw err; });
        res.redirect('/panel');
    });
});

app.get('/backend/regensecret', backend.checkAuth, function(req, res) {
    backend.refreshAppLocals(app);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        con.query(`UPDATE users SET secret="${await utils.generateRandom(25)}" WHERE id="${req.user.id}"`, function(err, row) { if(err) throw err; });
        res.redirect('/panel');
    });
});

app.get('/backend/delete/upload/:uniqueid', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    if(!req.params.uniqueid) return res.redirect('back');
    req.params.uniqueid = await utils.sanitize(req.params.uniqueid);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        let user = row[0];
        con.query(`SELECT * FROM uploads WHERE userid="${req.user.id}" AND uniqueid="${req.params.uniqueid}"`, function(err, row) {
            if(err) throw err;
            if(!row[0]) return res.redirect('/404');
            if(fs.existsSync(`./public/u/${user.folder}/${row[0].filename}`)) {
                try { fs.unlinkSync(`./public/u/${user.folder}/${row[0].filename}`) } catch(e) {};
            };
            con.query(`DELETE FROM uploads WHERE userid="${req.user.id}" AND uniqueid="${req.params.uniqueid}" LIMIT 1`, function(err, row) { if(err) throw err; });
            res.redirect('/panel');
        });
    });
});

app.get('/backend/deleteuser/:uniqueid', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    if(!req.params.uniqueid) return res.redirect('/404');
    req.params.uniqueid = await utils.sanitize(req.params.uniqueid);
    if(config.ownerIds.includes(req.params.uniqueid)) return res.send('You cannot delete a user that is an owner!');
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        con.query(`SELECT * FROM users WHERE id="${req.params.uniqueid}"`, function(err, row) {
            if(err) throw err;
            con.query(`DELETE FROM users WHERE id="${req.params.uniqueid}"`, function(err, row) {
                if(err) throw err;
            });
            if(fs.existsSync(`./public/u/${row[0].folder}`)) {
                fs.readdirSync(`./public/u/${row[0].folder}`).forEach(function(item) {
                    try { fs.unlinkSync(`./public/u/${row[0].folder}/${item}`) } catch(e) {};
                });
            };
        });
        res.redirect('/admin');
    });
});

app.get('/backend/deleteupload/:uniqueid', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    if(!req.params.uniqueid) return res.redirect('/404');
    req.params.uniqueid = await utils.sanitize(req.params.uniqueid);
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        con.query(`SELECT * FROM uploads WHERE uniqueid="${req.params.uniqueid}"`, function(err, upload) {
            if(err) throw err;
            if(!row[0]) return res.redirect('/admin');
            con.query(`SELECT * FROM users WHERE id="${upload[0].userid}"`, function(err, row) {
                if(err) throw err;
                if(row[0]) {
                    try {
                        fs.unlinkSync(`./public/u/${row[0].folder}/${upload[0].filename}`);
                    } catch(e) {};
                };
                con.query(`DELETE FROM uploads WHERE uniqueid="${req.params.uniqueid}"`, function(err, row) {
                    if(err) throw err;
                });
                res.redirect('/admin');
            });
        });
    });
});

app.get('/backend/deletestaff/:uniqueid', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    if(!req.params.uniqueid) return res.redirect('/404');
    req.params.uniqueid = await utils.sanitize(req.params.uniqueid);
    if(config.ownerIds.includes(req.user.id)) {
        if(config.ownerIds.includes(req.params.uniqueid)) return res.send('You cannot remove an owner from staff!');
        con.query(`DELETE FROM staff WHERE userid="${req.params.uniqueid}"`, function(err, row) {
            if(err) throw err;
        });
        res.redirect('/admin');
    } else {
        return res.redirect('/404');
    };
});

app.post('/backend/createstaff', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    req.body.userid = await utils.sanitize(req.body.userid);
    if(config.ownerIds.includes(req.user.id)) {
        con.query(`SELECT * FROM staff where userid="${req.body.userid}"`, function(err, row) {
            if(err) throw err;
            if(row[0]) return res.redirect('/admin');
            con.query(`INSERT INTO staff (userid) VALUES ("${req.body.userid}")`, function(err, row) {
                if(err) throw err;
            });
            res.redirect('/admin');
        });
    } else {
        return res.redirect('/404');
    };
});

app.post('/backend/update/folder', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    req.body.foldername = (await utils.sanitize(req.body.foldername)).toLowerCase();
    req.body.foldername = await backend.folderCheck(req.body.foldername)
    if(fs.existsSync(`./public/u/${req.body.foldername}`)) return res.send(`Folder name ${req.body.foldername} is already taken.`);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        fs.renameSync(`./public/u/${row[0].folder}`, `./public/u/${req.body.foldername}`);
        con.query(`UPDATE users SET folder="${req.body.foldername}" WHERE id="${req.user.id}"`, function(err, row) { if(err) throw err; });
        res.redirect('/panel');
    });
});

app.post('/backend/update/webhook', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    req.body.webhook = await utils.sanitize(req.body.webhook);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        con.query(`UPDATE users SET webhook="${req.body.webhook}" WHERE id="${req.user.id}"`, function(err, row) { if(err) throw err; });
        res.redirect('/panel');
    });
});

app.post('/backend/update/password', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    if(req.body.password !== req.body.confpassword) return res.send('Your passwords do not match...');
    let hashedPassword = await bcrypt.hash(req.body.confpassword, 13);
    con.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        con.query(`UPDATE users SET password="${hashedPassword}" WHERE id="${req.user.id}"`, function(err, row) { if(err) throw err; });
        req.logout(function(err) {
            if(err) { return next(err); }
        });
        res.redirect('/login');
    });
});

app.post('/backend/update/settings', backend.checkAuth, async function(req, res) {
    backend.refreshAppLocals(app);
    req.body.sitename = await utils.sanitize(req.body.sitename);
    req.body.sitecolor = await utils.sanitize(req.body.sitecolor);
    req.body.sitedesc = await utils.sanitize(req.body.sitedesc);
    req.body.public = Number(await utils.sanitize(req.body.public));
    if(req.body.public == 1) {
        req.body.public = true;
    } else {
        req.body.public = false;
    };
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        if(req.files[0]) fs.writeFileSync('./public/assets/logo.png', req.files[0].buffer);
        con.query(`UPDATE sitesettings SET sitename="${req.body.sitename}", sitecolor="${req.body.sitecolor}", sitedesc="${req.body.sitedesc}", public=${req.body.public}`, function(err, row) {
            if(err) throw err;
        });
        res.redirect('/admin');
    });
});

app.post('/register', backend.checkNotAuth, async (req, res) => {
    backend.refreshAppLocals(app);
    req.body.email = await utils.sanitize(req.body.email);
    try {
        let userid = backend.generateUserId(7);
        let hashedPassword = await bcrypt.hash(req.body.password, 13)
        con.query(`SELECT * FROM users WHERE email="${req.body.email}"`, async function (err, row) {
            if(err) throw err;
            if(!row[0]) {
                con.query(`SELECT * FROM sitesettings`, async function(err, row) {
                    if(err) throw err;
                    if(!row[0]) return console.log('No site settings found.');
                    if(!row[0].public) return res.send(`${row[0].sitename} is not currently open to the public. You must be whitelisted in order to use this application.`);
                    con.query(`INSERT INTO users (id, email, password, webhook, secret, folder, maxspace) VALUES ("${userid}", "${req.body.email}", "${hashedPassword}", "none", "${await utils.generateRandom(25)}", "${userid}", ${config.defaultMaxSpace})`, async function (err, row) {
                        if(err) throw err;
                    });
                    res.redirect('/login')
                });
            } else {
                res.redirect('/login')
            };
        });
    } catch {
        res.redirect('/register')
    };
});

app.post('/registermanual', backend.checkAuth, async (req, res) => {
    backend.refreshAppLocals(app);
    req.body.email = await utils.sanitize(req.body.email);
    req.body.maxspace = Number(await utils.sanitize(req.body.maxspace)); // MB
    if(isNaN(req.body.maxspace)) req.body.maxspace = config.defaultMaxSpace;
    con.query(`SELECT * FROM staff WHERE userid="${req.user.id}"`, async function(err, row) {
        if(err) throw err;
        if(!row[0]) return res.redirect('/404');
        try {
            let userid = backend.generateUserId(7);
            let hashedPassword = await bcrypt.hash(req.body.password, 13)
            con.query(`SELECT * FROM users WHERE email="${req.body.email}"`, async function (err, row) {
                if(err) throw err;
                if(!row[0]) {
                    con.query(`SELECT * FROM sitesettings`, async function(err, row) {
                        if(err) throw err;
                        if(!row[0]) return console.log('No site settings found.');
                        if(!row[0].public) return res.send(`${row[0].sitename} is not currently open to the public. You must be whitelisted in order to use this application.`);
                        con.query(`INSERT INTO users (id, email, password, webhook, secret, folder, maxspace) VALUES ("${userid}", "${req.body.email}", "${hashedPassword}", "none", "${await utils.generateRandom(25)}", "${userid}", ${req.body.maxspace})`, async function (err, row) {
                            if(err) throw err;
                        });
                        res.redirect('/admin')
                    });
                } else {
                    res.redirect('/admin')
                };
            });
        } catch {
            res.redirect('/404')
        };
    });
});

app.post('/auth/local', backend.checkNotAuth, passport.authenticate('local', {
    successRedirect: '/panel',
    failureRedirect: '/login',
    failureFlash: true
}))
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {failureRedirect: '/'}), async function(req, res) {
    con.query(`SELECT * FROM users WHERE email="${req.user.email}"`, async function (err, row) {
        if(err) throw err;
        if(!row[0]) {
            con.query(`SELECT * FROM sitesettings`, async function(err, row) {
                if(err) throw err;
                if(!row[0]) return console.log('No site settings found.');
                if(!row[0].public) return res.send(`${row[0].sitename} is not currently open to the public. You must be whitelisted in order to use this application.`);
                let hashedPassword = await bcrypt.hash(await utils.generateRandom(22), 12)
                con.query(`INSERT INTO users (id, email, password, webhook, secret, folder, maxspace) VALUES ("${req.user.id}", "${req.user.email}", "${hashedPassword}", "none", "${await utils.generateRandom(37)}", "${req.user.id}", ${config.defaultMaxSpace})`, async function (err, row) {
                    if(err) throw err;
                });
                res.redirect('/panel');
            });
        } else {
            res.redirect('/panel');
        };
    });
});

app.get('/logout', function(req, res) {
    req.logout(function(err) {
        if(err) { return next(err); }
    });
    res.redirect('/login');
});

// Searched the redirects for the page
config.redirects.forEach(element => {
    app.get(`/${element.name}`, (req, res) => {
        res.redirect(element.link);
    });
});

config.ownerIds.forEach(function(item) {
    con.query(`SELECT * FROM staff WHERE userid="${item}"`, function(err, row) {
        if(err) throw err;
        if(!row[0]) {
            con.query(`INSERT INTO staff (userid) VALUES ("${item}")`, function(err, row) {
                if(err) throw err;
            });
        };
    });
});

// MAKE SURE THIS IS LAST FOR 404 PAGE REDIRECT
app.get('*', function(req, res){
    res.render('404.ejs');
});

// Server Initialization
app.listen(config.port)

// Rejection Handler
process.on('unhandledRejection', (err) => { 
    if(config.debugMode) console.log(chalk.red(err));
});
