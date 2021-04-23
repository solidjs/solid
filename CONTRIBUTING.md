## Contributing

To make contributing easier, this repo has a `.devcontainer` configuration file ([learn more](https://code.visualstudio.com/docs/remote/containers#_creating-a-devcontainerjson-file)) that will configure VSCode for developing. If you're not already familiar with developing using VSCode and a devcontainer, I suggest you check out the [VSCode docs](https://code.visualstudio.com/docs/remote/containers#_creating-a-devcontainerjson-file). If you don't want to do that though, here's the short verson:

1. Open [VSCode](https://code.visualstudio.com/) on your computer.
2. Install the [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) official extension. Follow the installation instructions for the extension.
3. Clone this repo and open it on your computer. You should then be prompted to "Reopen in container" (do so).
4. After the container setup is complete, open the VSCode integrated terminal and run `npm install` to install all the packages.
5. After package installation is complete, try running `npm run test`. They should all pass.

### FAQ

1. By default, you might not be able to push any git commits using VSCode running inside a dev container. To fix this issue, read this [VSCode Article](https://code.visualstudio.com/docs/remote/containers#_sharing-git-credentials-with-your-container).
   - Additionally, try using the VSCode terminal to run `git fetch`. You might be prompted with a warning saying ~ "The authenticity of host can't be established" and asking you if you want to continue `(yes/no)`. After responding, you might be able to use VSCode's built in git UI normally again.
2. If you run out of memory while developing inside a docker container, see the [VSCode Docs](https://vscode.trafficmanager.net/docs/remote/troubleshooting#_speeding-up-containers-in-docker-desktop) for fixes. The short version is that you need to open up docker preferences/settings and change the amount of memory allocated to your containers.
