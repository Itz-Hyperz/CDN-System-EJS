CREATE DATABASE bosscdn CHARACTER SET utf8;
use bosscdn;

CREATE TABLE sitesettings (
    sitename TEXT,
    sitedesc TEXT,
    sitecolor TEXT,
    public boolean
);

CREATE TABLE users (
    id TEXT,
    email TEXT,
    password TEXT,
    webhook TEXT,
    secret TEXT,
    folder TEXT,
    maxspace INT
);

CREATE TABLE uploads (
    uniqueid TEXT,
    userid TEXT,
    fileid TEXT,
    filename TEXT,
    datetime TEXT
);

CREATE TABLE staff (
    userid TEXT
);

ALTER DATABASE bosscdn CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
ALTER TABLE sitesettings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
ALTER TABLE uploads CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
ALTER TABLE staff CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;

INSERT INTO sitesettings (sitename, sitedesc, sitecolor, public) VALUES ('CDN System', 'An awesome file storage server!', '#5c5e5e', 1);
INSERT INTO staff (userid) VALUES ("704094587836301392");