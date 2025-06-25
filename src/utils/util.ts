
import { SESClient } from "@aws-sdk/client-ses";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import { ConfigService } from "../config/config.service";

export async function sendEmail({
  address,
  subject,
  content,
  configService
}: {
  address: string,
  subject: string,
  content: string,
  configService: ConfigService
}) {
  const createSendEmailCommand = (toAddress, fromAddress) => {
    return new SendEmailCommand({
      Destination: {
        /* required */
        CcAddresses: [
          /* more items */
        ],
        ToAddresses: [
          toAddress,
          /* more To-email addresses */
        ],
      },
      Message: {
        /* required */
        Body: {
          /* required */
          Text: {
            Charset: "UTF-8",
            Data: content,
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: subject,
        },
      },
      Source: fromAddress,
      ReplyToAddresses: [
        /* more items */
      ],
    });
  }
  
  const sendEmailCommand = createSendEmailCommand(
    address,
    configService.get<string>("email.sender"),
  );

  try {
    const sesClient = new SESClient({
      region: configService.get<string>("aws.region") || "us-east-1"
    });
    return await sesClient.send(sendEmailCommand);
  } catch (e) {
    console.error("Failed to send email.");
    return e;
  }
}