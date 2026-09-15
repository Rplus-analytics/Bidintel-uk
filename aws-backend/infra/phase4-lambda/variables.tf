variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "private_subnet_ids" {
  description = "From phase3-network. VPC-attached functions land here."
  type        = list(string)
  default     = ["subnet-0ff77108be79ccdd5", "subnet-0a1094478008deedb"]
}

variable "lambda_security_group_id" {
  description = "From phase3-network. The SG that bidintel-1 accepts 5432 from."
  type        = string
  default     = "sg-054bd4a03c245e2e7"
}

variable "log_retention_days" {
  description = "14 days is enough to debug a bad ingestion run and short enough that log storage stays under a dollar."
  type        = number
  default     = 14
}

variable "build_dir" {
  description = "Where scripts/build-lambda.sh writes its zips."
  type        = string
  default     = "../../build"
}
