# --- Grade Guesser photo storage (spec 0006, step R1) -------------------
#
# The daily game's photos live as objects in a private bucket instead of as
# files under the web app's public directory. That move is the point of the
# 2026-08-21 revision: photos committed to the repo were served to the open
# internet the whole time the game was supposedly hidden behind
# GRADE_GAME_ENABLED, because a feature flag gates routes and modules but
# never gates static assets. A private bucket has no such gap (AC-13).
#
# Nothing in the running api reads any of this yet. R2 adds the GradePhoto
# table, R3 the upload endpoint; applying this on its own is inert.

resource "aws_s3_bucket" "grade_photos" {
  # Account id suffix for global uniqueness, the same shape the hand-created
  # state bucket uses. Interpolated rather than hardcoded — backend.tf spells
  # its account id out only because backend blocks cannot read data sources.
  bucket = "portfolio-grade-photos-${data.aws_caller_identity.current.account_id}"
}

# AC-13's actual mechanism. All four flags on: no public ACL or bucket policy
# can be set on this bucket, and any that somehow existed would be ignored.
# Browsers never reach these objects directly — the api mints a one-hour
# presigned URL per request (AC-14), which needs no public access at all.
resource "aws_s3_bucket_public_access_block" "grade_photos" {
  bucket = aws_s3_bucket.grade_photos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs disabled outright, matching the state bucket. With ownership enforced
# there is no per-object ACL for an upload to get wrong, so "private" is a
# property of the bucket rather than something every PutObject must remember.
resource "aws_s3_bucket_ownership_controls" "grade_photos" {
  bucket = aws_s3_bucket.grade_photos.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 is what a new bucket gets by default; declared explicitly so the
# encryption posture is readable here rather than inferred from an AWS default
# that is not part of this repo's record.
resource "aws_s3_bucket_server_side_encryption_configuration" "grade_photos" {
  bucket = aws_s3_bucket.grade_photos.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning is deliberately left OFF, which is the default and is recorded
# here so it reads as a choice rather than an oversight. AC-9's rollback path
# deletes the object when the row insert fails; under versioning that delete
# writes a marker and keeps the bytes, so the upload the rollback meant to
# erase would survive as a noncurrent version. Object keys are random and
# never reused (no overwrite to recover from), so versioning would protect
# against nothing while quietly weakening the one guarantee that matters.

# --- The api's access to that bucket ------------------------------------
#
# Three object actions and nothing else, per the spec's security model:
#   - GetObject     <- the vision call reads bytes; presigning signs a GET
#   - PutObject     <- the admin upload writes the re-encoded image
#   - DeleteObject  <- the AC-9 rollback when the row insert fails
#
# Scoped to this bucket's objects only. Note there is no ListBucket: nothing
# enumerates the bucket (the admin list reads GradePhoto rows, not S3), and
# the omission is intentional. Its one visible effect is that a GetObject for
# a key that does not exist returns 403 rather than 404, which is worth
# knowing before it is mistaken for a credentials problem.
#
# Presigning needs no permission of its own — a presigned URL is signed
# locally with these credentials and carries exactly this GetObject grant, so
# the URL can never outrank the policy below.

resource "aws_iam_policy" "api_grade_photos" {
  name        = "portfolio-api-grade-photos"
  description = "Read, write and delete Grade Guesser photo objects (spec 0006)."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GradePhotoObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.grade_photos.arn}/*"
      }
    ]
  })
}

# Same principal and same pattern as the Bedrock policy in bedrock.tf: the
# portfolio-api user is created by hand so no access key ever enters state,
# and Terraform reads it through the data source declared there.
resource "aws_iam_user_policy_attachment" "api_grade_photos" {
  user       = data.aws_iam_user.api.user_name
  policy_arn = aws_iam_policy.api_grade_photos.arn
}
