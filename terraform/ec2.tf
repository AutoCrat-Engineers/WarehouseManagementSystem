resource "aws_instance" "wms" {
  ami           = "ami-0f5ee92e2d63afc18"
  instance_type = "t3.micro"

  subnet_id              = aws_subnet.wms_public.id
  vpc_security_group_ids = [aws_security_group.wms_sg.id]
  iam_instance_profile   = "WMS-EC2-App-Profile"

  user_data = <<-EOF
  #!/bin/bash
  apt update -y
  apt install docker.io docker-compose nginx -y
  systemctl enable docker
  systemctl start docker
  EOF

  tags = { Name = "wms-server" }
}

resource "aws_eip" "wms_ip" {
  instance = aws_instance.wms.id
}
