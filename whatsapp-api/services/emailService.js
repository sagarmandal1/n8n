import nodemailer from 'nodemailer';

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Email templates
const emailTemplates = {
  'renewal-reminder': (data) => ({
    subject: `Your subscription expires in ${data.daysUntilExpiry} days`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Subscription Renewal Reminder</h2>
        <p>Dear ${data.name},</p>
        <p>Your ${data.plan} subscription will expire on ${new Date(data.expiryDate).toLocaleDateString()}.</p>
        <p>You have ${data.daysUntilExpiry} day(s) remaining.</p>
        <p>To ensure uninterrupted service, please renew your subscription.</p>
        <a href="${data.renewUrl}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px;">
          Renew Now
        </a>
      </div>
    `
  }),
  // Add more templates as needed
};

export const sendEmail = async ({ to, subject, template, data }) => {
  try {
    let emailContent = { subject, html: '' };
    
    if (template && emailTemplates[template]) {
      const templateData = emailTemplates[template](data);
      emailContent = { ...emailContent, ...templateData };
    } else {
      emailContent.html = `<p>${data.message || 'Notification'}</p>`;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@whatsappmanager.com',
      to,
      ...emailContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};