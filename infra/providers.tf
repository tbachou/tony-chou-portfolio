provider "aws" {
  region = "us-east-2"

  default_tags {
    tags = {
      project    = "genai-track"
      managed_by = "terraform"
    }
  }
}
