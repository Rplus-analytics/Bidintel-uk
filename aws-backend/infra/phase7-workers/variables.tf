variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "private_subnet_ids" {
  type    = list(string)
  default = ["subnet-0ff77108be79ccdd5", "subnet-0a1094478008deedb"]
}

variable "lambda_security_group_id" {
  type    = string
  default = "sg-054bd4a03c245e2e7"
}

variable "enable_schedules" {
  description = <<-EOT
    Master switch for every EventBridge rule in this stack.

    FALSE by default and deliberately so: these functions write to the database
    the application reads, and the first automatic run should follow a manual
    invocation that was inspected, not precede it.
  EOT
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "build_dir" {
  type    = string
  default = "../../build"
}
