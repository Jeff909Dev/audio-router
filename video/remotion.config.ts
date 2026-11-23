import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('png');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
Config.setCrf(20);
Config.setX264Preset('slow');
Config.setMuted(true);
