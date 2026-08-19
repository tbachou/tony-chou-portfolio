# S3 backend using Terraform's native S3 lockfile (Terraform >= 1.10),
# no DynamoDB lock table.
#
# The bucket is the one-time bootstrap resource documented in README.md:
# it does not exist as a Terraform resource because state cannot store the
# bucket that stores it. Backend blocks cannot read variables, so the name
# is a literal here.
#
# Bucket: portfolio-terraform-state-635474720027
# (suffix 635474720027 is the AWS account id the bucket was created in;
# deterministic and collision-free, safe to hardcode per the child spec.)
terraform {
  backend "s3" {
    bucket       = "portfolio-terraform-state-635474720027"
    key          = "portfolio/terraform.tfstate"
    region       = "us-east-2"
    use_lockfile = true
  }
}
