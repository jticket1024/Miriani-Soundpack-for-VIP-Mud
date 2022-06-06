const fs = require("fs");
const utils = require('../../../utils.js');
const path = require('path');
const conf = require('./conf.js');

const commands = {
    play: {
        syntax: 'play [<date> | <number of days ago>]',
        description: "Plays a specified log file back to the client from <date> or <days ago> using time stamps.",
        func: (data, middleware, linkedMiddleware, statusOfState) => {
            if (!statusOfState && data.command.length > 2) {
                const user = middleware.device.proxy.user;
                const today = new Date();
                const d = new Date(today.getTime());
                if (data.command.length === 3 && isFinite(data.command[2])) d.setDate(d.getDate() - Number(data.command[2]));
                else {
                    const t = Date.parse(data.command.slice(2).join(' '));
                    if (isNaN(t)) {
                        data.respond.push(`Invalid date.`);
                        return;
                    } else d.setTime(t);
                }
                const fileName = `${utils.englishOrdinalIndicator(d.getDate())}, on port ${middleware.device.socket.address().port}.txt`;
                const dirName = path.join(user.dir, user.logDir, String(d.getFullYear()), String(d.getMonth() + 1));
                const logFile = path.join(dirName, fileName);
                if (fs.existsSync(logFile)) {
                    middleware.setState("playback", {
                        data: {
                            speed: 1.0,
                            paused: false,
                            stopped: false,
                            currentTime: undefined,
                            lastLine: 0,
                            file: [],
                            filePath: "",
                            timers: []
                        },
                    }, (data, middleware, linkedMiddleware) => {
                        const sdata = middleware.states.playback.data;
                        if (!sdata.stopped) {
                            return 0;
                        } else {
                            return 0b10;
                        }
                    });
                    middleware.states.playback.timeout = 150000000000;
                    logPlay(logFile, middleware);
                    middleware.states.playback.data.filePath = logFile;
                }
                else data.respond.push(`Couldn't find a log file for ${utils.formatDate(d)}.`);
            } else if (statusOfState && data.command.length >= 2) {
                if (middleware.states.playback.data.paused) {
                    middleware.states.playback.data.paused = false;
                    logPlay(middleware.states.playback.data.filePath, middleware);
                } else data.respond.push("already playing: " + middleware.states.playback.data.filePath);
            }
        },
    },
    stop: {
        syntax: "stop",
        description: "Stops playback",
        func: (data, middleware, linkedMiddleware, statusOfState) => {
            if (!statusOfState) {
                data.respond.push("Nothing is Playing");
            } else {
                middleware.states.playback.data.stopped = true;
                for (i of middleware.states.playback.data.timers) clearTimeout(i);
                delete middleware.states.playback;
                data.respond.push("Stopped");
            }
        },
    },
    pause: {
        syntax: "pause",
        description: `Pauses the current playing log. <logplay resume> or <logplay play> resumes playback`,
        func: (data, middleware, linkedMiddleware, statusOfState) => {
            if (!statusOfState) {
                data.respond.push("Nothing is playing.");
            } else if (middleware.states.playback.data.paused) {
                data.respond.push('Already paused');
            } else {
                middleware.states.playback.data.paused = true;
                for (i of middleware.states.playback.data.timers) clearTimeout(i);
                data.respond.push("Paused");
            }
        },
    },
    resume: {
        syntax: 'resume',
        description: "resumes playback if playback is paused",
        func: (data, middleware, linkedMiddleware, statusOfState) => {
            if (!statusOfState) { data.respond.push("Nothing is playing") }
            else if (!middleware.states.playback.data.paused) { data.respond.push("Already playing") }
            else {
                middleware.states.playback.data.paused = false;
                logPlay(middleware.states.playback.data.filePath, middleware);
            }
        },
    },
    speed: {
        syntax: "speed <number>",
        description: "Changes the speed of the currently playing log (accepts any decimal number)",
        func: (data, middleware, linkedMiddleware, statusOfState) => {
            if (!statusOfState) { data.respond.push("Nothing is playing. Default playing speed is 1.0"); }
            else if (!isNaN(data.command[2]) && Number(data.command[2]) > 0) {
                Number(data.command[2]) == middleware.states.playback.data.speed ? data.respond.push(`Playing speed is already${data.command[2]}`) : middleware.states.playback.data.speed = Number(data.command[2]);
            } else { data.respond.push("not valid!"); }
        },
    },
    seek: {
        syntax: "seek <number>",
        description: "Sets current playback to the given line on the log file (can be useful to skip passed long absences)",
        func: (data, middleware, statusOfState) => {
            if (!data.command.length === 3 || (isNaN(data.command[2]) || parseInt(data.command[2]) < 0)) {
                data.respond.push("invalid input");
                return;
            }
            if (!statusOfState) data.respond.push("Nothing is playing!");
            else if (parseInt(data.command[2]) < middleware.states.playback.data.file.length) {
                for (i of middleware.states.playback.data.timers) clearTimeout(i);
                middleware.states.playback.data.lastLine = parseInt(data.command[2]);
                logPlay(middleware.states.playback.data.filePath, middleware);
            }
        },
    },
};

const logplay = function (data, middleware, linkedMiddleware) {
    data.forward.pop();
    data.command = data.input.trim().toLowerCase().split(/\s+/);
    const statusOfState = Boolean(middleware.states.playback);
    if (data.command.length === 1) {
        data.respond.push(`Available arguments for the ${data.command[0]} command:`);
        for (let command in commands) data.respond.push(`  ${commands[command].syntax || command}. ${commands[command].description}`);
    } else if (data.command[1] in commands)
        commands[data.command[1]].func(data, middleware, linkedMiddleware, statusOfState);
    else {
        for (let command in commands) {
            if (command.startsWith(data.command[1])) {
                commands[command].func(data, middleware, linkedMiddleware, statusOfState);
                return;
            }
        }
        data.respond.push(`${data.command[0]} command "${data.command[1]}" not recognized.`);
    }
}

function logPlay(logPath, middleware) {

    if (!middleware.states.playback.data.file.length > 0) {
        middleware.states.playback.data.file = fs.readFileSync(logPath, "utf8").split('\r\n');
        timeTagConverter(middleware.states.playback.data.file);
        if (middleware.states.playback.data.file[middleware.states.playback.data.file.length - 1] == "") middleware.states.playback.data.file.pop();
    }
    function getMilliseconds(textTo) {
        const timeMatch = textTo.match(/^(\[([0-9]{1,8})\]: )(.*$)/);
        if (timeMatch) {
            let integerPart = parseInt(timeMatch[2]);
            let orjLine = timeMatch[3];
            return [integerPart, orjLine];
        }
    }
    function showLine(middleware, i) {
        if (!middleware.states.playback) {
            return;
        } else if (middleware.states.playback.data.stopped) {
            return;
        } else if (middleware.states.playback.data.paused) {
            return;
        }
        let nextTime;
        let line = getMilliseconds(middleware.states.playback.data.file[i]);
        middleware.states.playback.data.currentTime = line[0];
        middleware.device.respond(line[1]);
        let difference;
        if (i < middleware.states.playback.data.file.length - 1) {
            nextTime = getMilliseconds(middleware.states.playback.data.file[i + 1])[0];
            difference = (nextTime - middleware.states.playback.data.currentTime) / middleware.states.playback.data.speed;
            middleware.states.playback.data.timers.push(setTimeout(showLine, difference, middleware, ++middleware.states.playback.data.lastLine));
        } else if (i == middleware.states.playback.data.file.length - 1) {
            middleware.device.respond("End of the file");
            delete middleware.states.playback;
            return;
        }

    }
    showLine(middleware, middleware.states.playback.data.lastLine);

}

module.exports = logplay;

function timeTagConverter(log) {
    var timeTag = 0;
    for (let i in log) {
        var oldTag = log[i].match(/(.*)(\t\[([0-9:]+)\])$/);
        if (oldTag) {
            let x = oldTag[3].split(":");
            if (x.length == 3)
                timeTag = ((parseInt(x[0]) * 3600) + (parseInt(x[1]) * 60) + parseInt(x[2])) * 1000;
            else if (x.length === 4)
                timeTag = ((parseInt(x[0]) * 3600) + (parseInt(x[1]) * 60) + parseInt(x[2])) * 1000 + parseInt(x[3]);
            log[i] = `[${timeTag}]: ${oldTag[1]}`;
        } else
            log[i] = `[${timeTag}]: ${log[i]}`;
    }
}
