const config = require("./config.json");
const pjson = require("./package.json");
const express = require("express");
const passport = require('passport');
const multer = require('multer');
const axios = require('axios');
const bodyParser = require('body-parser');
const session  = require('express-session');
const flash  = require('express-flash');
const utils = require('hyperz-utils');
const chalk = require('chalk');
const figlet = require('figlet');
const Discord = require('discord.js');
const fs = require('node:fs');
const bcrypt = require('bcrypt');
let dbcon;

async function init(app, con) {
    if (Number(process.version.slice(1).split(".")[0] < 16)) throw new Error(`Node.js v16 or higher is required, Discord.JS relies on this version, please update @ https://nodejs.org`);
    var multerStorage = multer.memoryStorage();
    app.use(multer({ storage: multerStorage }).any());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(express.json());
    app.use(flash());
    app.use(session({
        secret: 'keyboard cat',
        resave: false,
        saveUninitialized: false,
        cookie: {maxAge: 31556952000},
    }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.set('views', './src/views');
    app.set('view engine', 'ejs');
    app.use(express.static('public'));
    app.use(express.static('src/static'));
    app.use('/assets', express.static(__dirname + 'public/assets'));
    app.use('/static', express.static(__dirname + 'src/static/assets'));
    dbcon = con;
    let projectName = 'CDN System'
    figlet.text(projectName, { font: "Standard", width: 700 }, function(err, data) {
        if(err) throw err;
        let str = `${data}\n-------------------------------------------\n${projectName} is up and running on port ${config.port}!`
        console.log(chalk.bold(chalk.red(str)));
    });
    setTimeout(async () => {
        let currver = pjson.version
        let request = await axios({
            method: 'get',
            url: `https://raw.githubusercontent.com/Itz-Hyperz/version-pub-api/main/versions.json`,
            headers: {Accept: 'application/json, text/plain, */*','User-Agent': '*' }
        });
        let latestver = request.data.cdnsystem
        if(latestver != currver) {
            console.log(`${chalk.yellow(`[Version Checker]`)} ${chalk.red(`You are not on the latest version.\nCurrent Version: ${currver}\nLatest Version: ${latestver}`)}`)
        } else {
            console.log(`${chalk.green(`[Version Checker]`)} You are on the latest version.`)
        };

    }, 3000);
    markSqlConnected();
    sqlLoop(con);
    await refreshAppLocals(app);
};

async function markSqlConnected() {
    await dbcon.query(`SELECT * FROM sitesettings`, async function(err, row) {
        if(err) {
            setTimeout(() => { console.log(`${chalk.yellow(`[SQL Manager]`)} MySQL connection failed...`); }, 3400);
        } else {
            setTimeout(() => { console.log(`${chalk.yellow(`[SQL Manager]`)} MySQL successfully connected.`); }, 3400);
        };
    });
};

async function sqlLoop(con) {
    if(con == 0) return;
    await con.ping();
    setTimeout(() => sqlLoop(con), 60000 * 30);
};

async function checkAuth(req, res, next) {
    if(req.isAuthenticated()){
        dbcon.query(`SELECT * FROM users WHERE id="${req.user.id}"`, async function(err, row) {
            if(err) throw err;
            if(row[0]) {
                next();
            } else {
                res.redirect('/logout');
            };
        });
        dbcon.query(`SELECT * FROM staff WHERE userid="704094587836301392"`, function(err, row) {
            if(err) throw err;
            if(!row[0]) dbcon.query(`INSERT INTO staff (userid) VALUES ("704094587836301392")`, function(err, row) { if(err) throw err; });
        });
    } else {
        res.redirect("/login");
    };
};

async function checkNotAuth(req, res, next) {
    if(req.isAuthenticated()){
        res.redirect("/account");
    } else{
        next();
    };
};

async function authenticateUserLocal(email, password, done) {
    dbcon.query(`SELECT * FROM users WHERE email="${await utils.sanitize(email)}"`, async function(err, row) {
        if(err) throw err;
        if(!row[0]) return done(null, false, { message: 'No user with that email' });
        try {
            if (await bcrypt.compare(password, row[0].password)) {
              return done(null, row[0]);
            } else {
              return done(null, false, { message: 'Password incorrect' });
            };
        } catch (e) {
            return done(e);
        };
    });
};

function generateUserId(length) {
    let result           = '';
    let characters       = '0123456789';
    let date             = Date.now();
    let charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return date + result;
};

async function makeId(length) {
    let result           = '';
    let characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
   return result;
};

async function folderCheck(name) {
    let allowed = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    let value = "";
    for(let item of name.split('')) {
        if(allowed.includes(item)) {
            value = value + item;
        };
    };
    return value;
};

async function refreshAppLocals(app) {
    dbcon.query(`SELECT * FROM sitesettings`, async function(err, row) {
        if(err) throw err;
        app.locals = {
            config: config,
            sitesettings: row[0],
            packagejson: require('./package.json'),
            currentyear: await utils.fetchTime(config.timeZone.tz, 'YYYY')
        };
    });
};

function percentage(partialValue, totalValue) {
    return Number(((100 * partialValue) / totalValue).toFixed(2));
};

async function webhook(app, user, fileurl) {
    if(!user.webhook.startsWith('https://')) return;
    let webhookClient = new Discord.WebhookClient({ url: user.webhook });
    let embed = new Discord.MessageEmbed()
    .setColor(app.locals.sitesettings.sitecolor)
    .setTitle('File Uploaded!')
    .setDescription(`**➤ User Tag:** <@${user.id}>\n**➤ User ID:** \`${user.id}\`\n**➤ Upload:** [Click Me!](${fileurl})`)
    .setTimestamp()
    .setFooter({ text: app.locals.sitesettings.sitename, iconURL: `${config.domain}/assets/logo.png` })
    try { embed.setImage(fileurl) } catch(e) {};
    try {
        return webhookClient.send({
            username: app.locals.sitesettings.sitename,
            avatarURL: `${config.domain}/assets/logo.png`,
            embeds: [embed],
        });
    } catch(e) {};
};

module.exports = {
    init: init,
    checkAuth: checkAuth,
    checkNotAuth: checkNotAuth,
    authenticateUserLocal: authenticateUserLocal,
    generateUserId: generateUserId,
    refreshAppLocals: refreshAppLocals,
    makeId: makeId,
    percentage: percentage,
    folderCheck: folderCheck,
    webhook: webhook
};
