export type VtexWebhookPayload = {
  orderId?: string;
  status?: string;
  creationDate?: string;
  OrderId?: string;
  State?: string;
  LastState?: string;
  LastChange?: string;
  CurrentChange?: string;
  Domain?: string;
  Origin?: {
    Account?: string;
    Key?: string;
  } | null;
  packageAttachment?: {
    packages?: Array<{
      trackingUrl?: string | null;
    }> | null;
  } | null;
  clientProfileData?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};
