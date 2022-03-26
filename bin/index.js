#! /usr/bin/env node
const Configstore = require('configstore');
const { prompt } = require('enquirer');
const fs = require('fs').promises;
const replace = require('replace-in-file');
const yargs = require('yargs');
const open = require('open');
const express = require('express');
const axios = require('axios');
const dtformat = require('date-and-time');
const redirect = encodeURIComponent('http://localhost:3000/oauth');
const state = "TMPCLI";
const usage = "\n Retrieves Stream Keys from Restream Events and adds them to profiles";

const config = new Configstore('restream-cli');

var clientId = config.get('client_id');
var clientSecret = config.get('client_secret');
var profilePath = config.get('profile_path');

const setConfig = async function (argv) {
  const enteredClientId = await prompt({
    type: 'input',
    name: 'client_id',
    message: 'Enter your Client Id from the Restream Developer Portal'
  });

  const enteredClientSecret = await prompt({
    type: 'input',
    name: 'client_secret',
    message: 'Enter your Client Secret from the Restream Developer Portal'
  });

  const enteredProfilePath = await prompt({
    type: 'input',
    name: 'profile_path',
    message: 'Enter the path to the directory where your OBS profiles live'
  });

  config.set({
    client_id: enteredClientId.client_id,
    client_secret: enteredClientSecret.client_secret,
    profile_path: enteredProfilePath.profile_path
  });

  clientId = enteredClientId.client_id;
  clientSecret = enteredClientSecret.client_secret;
  profilePath = enteredProfilePath.profile_path;
  getLogin();
}

if (clientId == null) {
  setConfig();
}

const handleError = function (error) {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    console.log(error.response.data);
    console.log(error.response.status);
    console.log(error.response.headers);
  } else if (error.request) {
    // The request was made but no response was received
    // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
    // http.ClientRequest in node.js
    console.log(error.request);
  } else {
    // Something happened in setting up the request that triggered an Error
    console.log('Error', error.message);
  }
  console.log(error.config);
};

const refreshToken = async function () {
  const refresh = config.get('refresh');
  const res = await axios.post('https://api.restream.io/oauth/token',
    `grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refresh}`)
    .catch(handleError);  

  //console.log(res.data);
  const token = res.data['access_token'];
  const refreshNew = res.data['refresh_token'];
  const expires = res.data['accessTokenExpiresEpoch'];  
  config.set({ 
    token: token,
    refresh: refreshNew,
    expires: expires
  });  
};

const getLogin = async function handler(argv) {
  const app = express();

  let resolve;
  const p = new Promise((_resolve) => {
    resolve = _resolve;
  });

  app.get('/oauth', function (req, res) {
    console.log('server called');
    console.log(req.query.code);
    resolve(req.query.code);      
    res.end('<html><body>Authorized. You can close your browser.</body></html>');

  });

  const server = await app.listen(3000);

  open(`https://api.restream.io/login?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&state=${state}`);

  //Wait for auth code
  const code = await p;
  
  const res = await axios.post('https://api.restream.io/oauth/token',
    `grant_type=authorization_code&client_id=${clientId}&client_secret=${clientSecret}&code=${code}&redirect_uri=${redirect}`)
    .catch(handleError);
  const token = res.data['access_token'];
  const refresh = res.data['refresh_token'];
  const expires = res.data['accessTokenExpiresEpoch'];
  //console.log(res.data);
  await server.close();    
  console.log('Logged in successfully with token ' + token);
  config.set({ 
    token: token,
    refresh: refresh,
    expires: expires
  });
};

const getList = async function (argv) {
  const token = config.get('token');
  var res = null;

  const sendRequest = async () => {
    try {
      res = await axios.get('https://api.restream.io/v2/user/events/upcoming',
        {
          headers: {'Authorization': `Bearer ${token}`}
        }
      );
      return res;
    } catch(error) {
      if (error.response.data.error.name === "invalid_token") {
        console.log("Token invalid, retrying");
        await refreshToken();
        return getList(argv);        
      } else {
        console.log(error.response.data);
      }
    }
  };

  var data = await sendRequest();

  return data.data;
  
};

const getKeys = async function (argv) {
  var data = await getList();

  var keys = []
  const token = config.get('token');

  for (const ev of data) {
      //console.log(ev.id);
      const res = await axios.get(`https://api.restream.io/v2/user/events/${ev.id}/streamKey`,
        {
          headers: {'Authorization': `Bearer ${token}`}
        }
      ).catch(async function (error) {
        if (error.response.data.error.name === "invalid_token") {
          console.log("Token invalid, retrying");
          await refreshToken();
          return getKeys(argv);          
        } else {
          console.log(error.response.data);
        }
      });
      
      var dt = new Date(ev.scheduledFor * 1000);
      //console.log(res.data);
      /*
      console.log(`\n${ev.title}`);
      console.log(`scheduled for: ${dt.toLocaleString()}`);
      console.log(`key: ${res.data.streamKey}\n`);
      */
      keys.push({
        key: res.data.streamKey,
        title: ev.title,
        date: dt
      });  
  }

  keys.sort((a,b) => b.date - a.date );
  return keys;

};

const createProfile = async function (key, name, title) 
{
  //Make a copy of the template folder
  try {
    await fs.rm(`${profilePath}/${name}`, {recursive: true});
  } catch (error) {
    if (error.code === 'ENOENT') { 
      console.log (`${name} : (no old version)`);
    } else {
      console.log(error);
      throw error;
    }
  }

  await fs.cp(`${profilePath}/Main`, `${profilePath}/${name}`, {recursive: true});
  replace({
    files: `${profilePath}/${name}/basic.ini`,
    from: /Name=.*/,
    to: `Name=${title}`
  });

  replace({
    files: `${profilePath}/${name}/service.json`,
    from: /\"key\"\:\"([a-z0-9_]*)\",/,
    to: `"key":"${key}",`
  })
};

const makeProfiles = async function()
{
  var keys = await getKeys();
  console.log('keys');
  console.log(keys);

  keys.forEach(function (ev) {
    var title=`${dtformat.format(ev.date, 'MMM D YYYY h:mma')} ${ev.title}`;
    var name=`restream_${dtformat.format(ev.date, 'HHmm')}`;

    console.log(`Creating Profile '${name}' : ${title}`);

    createProfile(ev.key, name, title);
  });
}



yargs.command(
  'config',
  'Set Configuration',
  function (yargs ){
    return yargs.option('config', {describe: 'Configuration'})
  },
  setConfig
).help().argv;


yargs.command(
  'login',
  'Log in to Slack and get your token',
  function (yargs ){
    return yargs.option('login', {describe: 'Login to restream'})
  },
  getLogin
).help().argv;

yargs.command(
  'list',
  'List upcoming events',
  function (yargs ){
    return yargs.option('list', {describe: 'List upcoming events'})
  },
  async function (argv) {
    var data = await getList();
    console.log(data);
  }
).help().argv

yargs.command(
  'keys',
  'Get Stream Keys for upcoming events',
  function (yargs ){
    return yargs.option('keys', {describe: 'Get Stream Keys for upcoming events'})
  },
  async function (argv) {
    var data = await getKeys();
    console.log(data);
  }  
).help().argv

yargs.command(
  'profiles',
  'Create OBS Profiles for upcoming events',
  function (yargs ){
    return yargs.option('profiles', {describe: 'Create OBS Profiles for upcoming events'})
  },
  async function (argv) {
    await refreshToken();
    await makeProfiles(argv);

  }
).help().argv
