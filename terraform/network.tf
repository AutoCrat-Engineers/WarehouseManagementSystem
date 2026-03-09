resource "aws_vpc" "wms_vpc" {
  cidr_block = "10.0.0.0/16"
  tags       = { Name = "wms-vpc" }
}

resource "aws_subnet" "wms_public" {
  vpc_id                  = aws_vpc.wms_vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.wms_vpc.id
}

resource "aws_route_table" "rt" {
  vpc_id = aws_vpc.wms_vpc.id
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.rt.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route_table_association" "assoc" {
  subnet_id      = aws_subnet.wms_public.id
  route_table_id = aws_route_table.rt.id
}
