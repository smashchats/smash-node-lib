echo -e "\nStarting post create command script..."
echo "Dev machine:"
uname -a

echo -e "\nInstalling npm dependencies..."
echo 'source <(npm completion)' >> /home/node/.bashrc
sudo chown -R node:node node_modules dist
npm install

echo -e "\nChecking radicle installation..."
sudo chown -R node:node /home/node/.radicle/bin
echo 'export PATH=$PATH:/home/node/.radicle/bin' >> /home/node/.bashrc
export PATH=$PATH:/home/node/.radicle/bin
if ! command -v rad &> /dev/null || ! rad --version &> /dev/null; then
    echo "Installing radicle..."
    curl -sSf https://radicle.xyz/install | sh
else
    echo "Radicle is already installed"
fi

echo -e "\n*******************************"
echo -e "\nDev container ready!".
echo -e "\n*******************************\n"
