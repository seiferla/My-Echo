terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

variable "hcloud_token" {
  type      = string
  sensitive = true # pass with TF_VAR_hcloud_token, never commit
}

variable "ssh_public_key" {
  type        = string
  description = "Content of your public key, e.g. file(\"~/.ssh/id_ed25519.pub\")"
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "Who may reach SSH. Restrict to your own IP if possible."
}

variable "server_type" {
  type    = string
  default = "cx22"
}

variable "location" {
  type    = string
  default = "fsn1"
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "main" {
  name       = "myecho"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "main" {
  name = "myecho"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "backend" {
  name         = "myecho-backend"
  image        = "ubuntu-24.04"
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.main.id]
  firewall_ids = [hcloud_firewall.main.id]

  user_data = <<-EOT
    #cloud-config
    package_update: true
    runcmd:
      - git clone https://github.com/seiferla/My-Echo.git /opt/My-Echo
      - bash /opt/My-Echo/deploy/setup.sh
  EOT
}

output "server_ip" {
  value = hcloud_server.backend.ipv4_address
}
