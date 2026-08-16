const subscriptions = {
  currency: "BDT",
  billing: "monthly",
  plans: [
    {
      id: "starter",
      name: "Starter",
      price: 300,
      pricePerSession: 300,
      sessions: 1,
      description:
        "Perfect for individuals or small businesses starting with WhatsApp automation.",
      features: [
        "1 WhatsApp Number",
        "Unlimited Messages",
        "Basic Analytics",
        "Email Support",
        "API Access",
        "Webhook Support",
        "Message Templates",
        "30 Days Message History"
      ],
      cta: "Get Started",
      highlighted: false,
      popular: false
    },
    {
      id: "basic",
      name: "Basic",
      price: 800,
      pricePerSession: 400,
      sessions: 2,
      description:
        "Ideal for small businesses needing 2 WhatsApp numbers for customer communication.",
      features: [
        "2 WhatsApp Numbers",
        "Unlimited Messages",
        "Advanced Analytics",
        "Priority Support",
        "API Access",
        "Webhook Support",
        "Message Templates",
        "90 Days Message History",
        "Bulk Messaging",
        "Auto-replies"
      ],
      cta: "Subscribe Now",
      highlighted: false,
      popular: true
    },
    {
      id: "pro",
      name: "Pro",
      price: 1800,
      pricePerSession: 360,
      sessions: 5,
      description:
        "Perfect for growing businesses with up to 5 WhatsApp numbers for team collaboration.",
      features: [
        "5 WhatsApp Numbers",
        "Unlimited Messages",
        "Advanced Analytics",
        "Priority Support",
        "API Access",
        "Webhook Support",
        "Message Templates",
        "180 Days Message History",
        "Bulk Messaging",
        "Auto-replies",
        "Team Collaboration",
        "Custom Webhooks",
        "Advanced Reporting",
        "WhatsApp Business API"
      ],
      cta: "Upgrade Now",
      highlighted: true,
      popular: false
    },
    {
      id: "business",
      name: "Business",
      price: 3500,
      pricePerSession: 350,
      sessions: 10,
      description:
        "For established businesses requiring up to 10 WhatsApp numbers with advanced features.",
      features: [
        "10 WhatsApp Numbers",
        "Unlimited Messages",
        "Enterprise Analytics",
        "24/7 Priority Support",
        "Dedicated API",
        "Custom Webhooks",
        "Unlimited Message Templates",
        "365 Days Message History",
        "Advanced Bulk Messaging",
        "Smart Auto-replies",
        "Team Collaboration",
        "Advanced Reporting",
        "WhatsApp Business API",
        "Custom Integrations",
        "Dedicated Account Manager"
      ],
      cta: "Contact Sales",
      highlighted: false,
      popular: false
    },
    {
      id: "enterprise",
      name: "Enterprise",
      price: 8000,
      pricePerSession: 400,
      sessions: 20,
      description:
        "Complete solution for large organizations with custom requirements and unlimited scaling.",
      features: [
        "20+ WhatsApp Numbers",
        "Unlimited Messages",
        "Enterprise Analytics Dashboard",
        "24/7 Dedicated Support",
        "Custom API Integration",
        "Advanced Webhooks",
        "Unlimited Message Templates",
        "Permanent Message History",
        "Enterprise Bulk Messaging",
        "AI-Powered Auto-replies",
        "Multi-team Collaboration",
        "Real-time Reporting",
        "WhatsApp Business API Premium",
        "Custom Feature Development",
        "Dedicated Account Manager",
        "SLA Guarantee 99.9%",
        "On-premise Deployment Option"
      ],
      cta: "Contact Enterprise Sales",
      highlighted: false,
      popular: false
    }
  ],
  features: {
    messaging: [
      "Unlimited Messages",
      "Text, Images, Videos, Audio",
      "Documents & Files",
      "Location Sharing",
      "Message Templates",
      "Bulk Messaging",
      "Auto-replies"
    ],
    integration: [
      "API Access",
      "Webhook Support",
      "Custom Integrations",
      "MCP Server Integration",
      "CRM Integration"
    ],
    management: [
      "Multiple Sessions",
      "Team Collaboration",
      "Analytics Dashboard",
      "Message History",
      "User Management"
    ],
    support: [
      "Email Support",
      "Priority Support",
      "24/7 Support",
      "Dedicated Account Manager",
      "SLA Guarantee"
    ]
  },
  fwPlans: [
    {
      id: "fwbot_1",
      name: "Forwarding Bot - 1 Day",
      price: 50,
      durationDays: 1,
      description: "Get forwarding bot access for 1 day.",
      features: ["Auto Forward Orders", "Negative Reaction Shield", "File/Media Reply Forwarding"]
    },
    {
      id: "fwbot_3",
      name: "Forwarding Bot - 3 Days",
      price: 120,
      durationDays: 3,
      description: "Get forwarding bot access for 3 days.",
      features: ["Auto Forward Orders", "Negative Reaction Shield", "File/Media Reply Forwarding"]
    },
    {
      id: "fwbot_7",
      name: "Forwarding Bot - 7 Days",
      price: 250,
      durationDays: 7,
      description: "Get forwarding bot access for 7 days.",
      features: ["Auto Forward Orders", "Negative Reaction Shield", "File/Media Reply Forwarding"]
    },
    {
      id: "fwbot_15",
      name: "Forwarding Bot - 15 Days",
      price: 450,
      durationDays: 15,
      description: "Get forwarding bot access for 15 days.",
      features: ["Auto Forward Orders", "Negative Reaction Shield", "File/Media Reply Forwarding"]
    },
    {
      id: "fwbot_30",
      name: "Forwarding Bot - 30 Days",
      price: 800,
      durationDays: 30,
      description: "Get forwarding bot access for 30 days.",
      features: ["Auto Forward Orders", "Negative Reaction Shield", "File/Media Reply Forwarding"]
    }
  ]
};

export default subscriptions;