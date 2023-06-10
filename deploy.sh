#sudo rm -r build
sudo ./build.sh
sudo docker build -t zkb-map . -f Dockerfile
sudo docker stop zkb-map; sudo docker rm zkb-map; sudo docker run --name zkb-map --restart unless-stopped -d -p 3131:3131 zkb-map

