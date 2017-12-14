start:
	@printf "\e[0;32mStarting PM2..\e[0m\n"
	@pm2 start pm2.config.js
	@printf "\e[0;32mStarting Webpack..\e[0m\n"
	@npm run watch

stop:
	@printf "\e[0;32mStopping PM2..\e[0m\n"
	@pm2 kill
