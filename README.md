# obs-restream-automator
Automatically create OBS profiles preloaded with keys for events on Restream

Restream provides an OBS integration, but unfortunately it only works with their 'Dashboard' stream, which creates events on services as soon as the stream begins. 

If you want to automatically load a key from a pre-published event in Restream Events, there's no easy way to do it. And the OBS API doesn't lend itself to adding stream keys. 

This script will allow you to query the Restream API, get a list of events, and automatically create a profile with the key. For each event, the script will copy a profile in a folder called 'Main', and then swap the name and stream key with your Restream Event. 

To set up: 

* Download or clone this repository
* Run `npm install` in the root folder
* Create your application in the Restream Developer Portal: https://developers.restream.io/apps
* Run `npm install -g .` to install the utility
* Run `getstreamkeys config` to run the first-run configuration. This will ask you for your config details from the Developer Portal as well as where your OBS profiles live
* Run `getstreamkeys profiles` to build your profiles!

