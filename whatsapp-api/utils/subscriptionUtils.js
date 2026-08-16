// Currency formatting
export const currencySymbols = {
  'BDT': '৳',
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'INR': '₹'
};

// Format currency with locale
export function formatCurrency(amount, currency = 'BDT') {
  const symbol = currencySymbols[currency] || currency;
  return `${symbol}${amount.toLocaleString()}`;
}

// Calculate yearly price with discount
export function calculateYearlyPrice(monthlyPrice, discountPercent = 20) {
  return Math.round(monthlyPrice * 12 * ((100 - discountPercent) / 100));
}

// Calculate prorated amount for plan changes
export function calculateProratedAmount(oldPlanPrice, newPlanPrice, remainingDays, totalDaysInCycle = 30) {
  const dailyRateDifference = (newPlanPrice - oldPlanPrice) / totalDaysInCycle;
  return Math.round(dailyRateDifference * remainingDays);
}

// Calculate remaining days
export function calculateRemainingDays(endDate) {
  const now = new Date();
  const end = new Date(endDate);
  const diffTime = end - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Generate unique reference IDs
export function generateReference(prefix = 'REF') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}

// Validate subscription data
export function validateSubscriptionData(data, requiredFields) {
  const errors = [];
  
  requiredFields.forEach(field => {
    if (!data[field]) {
      errors.push(`${field} is required`);
    }
  });
  
  if (data.amount && data.amount <= 0) {
    errors.push('Amount must be greater than 0');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Plan comparison utilities
export class PlanComparator {
  static isUpgrade(currentPlanPrice, newPlanPrice) {
    return newPlanPrice > currentPlanPrice;
  }
  
  static isDowngrade(currentPlanPrice, newPlanPrice) {
    return newPlanPrice < currentPlanPrice;
  }
  
  static getPriceDifference(currentPlanPrice, newPlanPrice) {
    return newPlanPrice - currentPlanPrice;
  }
  
  static getSessionsDifference(currentPlanSessions, newPlanSessions) {
    return newPlanSessions - currentPlanSessions;
  }
}

// Session management
export class SessionManager {
  static calculateProgress(activeSessions, maxSessions) {
    const progressPercent = (activeSessions / maxSessions) * 100;
    return Math.min(progressPercent, 100);
  }
  
  static validateSessionLimit(activeSessions, maxSessions) {
    return activeSessions <= maxSessions;
  }
}