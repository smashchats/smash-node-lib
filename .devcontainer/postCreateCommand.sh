#!/bin/bash

# Function to print section headers
print_header() {
    echo -e "\n$1"
}

# Function to create directory if it doesn't exist
ensure_dir() {
    [ ! -d "$1" ] && mkdir -p "$1"
}

# Function to set ownership for a path
set_ownership() {
    [ -e "$1" ] && sudo chown -R node:node "$1" || echo "Warning: Could not change ownership of $1"
}

# Function to add to PATH
add_to_path() {
    local path_to_add="$1"
    grep -q "export PATH=\$PATH:$path_to_add" /home/node/.bashrc || echo "export PATH=\$PATH:$path_to_add" >> /home/node/.bashrc
    export PATH=$PATH:$path_to_add
}

# Function to install Radicle
install_radicle() {
    echo "Installing radicle..."
    curl -sSf https://radicle.xyz/install | sh
    set_ownership "/home/node/.radicle"
}

# Function to setup directories
setup_directories() {
    print_header "Creating necessary directories..."
    local dirs=("$@")
    for dir in "${dirs[@]}"; do
        ensure_dir "$dir"
        set_ownership "$dir"
    done
}

# Function to setup npm
setup_npm() {
    print_header "Installing npm dependencies..."
    echo 'source <(npm completion)' >> /home/node/.bashrc
    npm install
}

# Function to setup Radicle
setup_radicle() {
    print_header "Checking radicle installation..."
    add_to_path "/home/node/.radicle/bin"
    chmod -R +x /home/node/.radicle/bin

    if ! command -v rad &> /dev/null || ! rad --version &> /dev/null; then
        install_radicle
    else
        echo "Radicle is already installed"
    fi
}

# Main script execution
main() {
    print_header "Starting post create command script..."
    echo "Dev machine:"
    uname -a

    local dirs=(
        "node_modules"
        "dist"
        "coverage"
    )

    setup_directories "${dirs[@]}"
    setup_npm
    setup_radicle

    print_header "*******************************"
    echo "Dev container ready!"
    echo -e "*******************************\n"
}

# Run the main function
main
