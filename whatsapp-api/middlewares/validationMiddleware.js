export const validateRequest = (schema) => {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      // Check required fields
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }
      
      // Skip validation if field is optional and not provided
      if (rules.optional && (value === undefined || value === null)) {
        continue;
      }
      
      // Type validation
      if (rules.type && value !== undefined && value !== null) {
        const type = typeof value;
        if (rules.type === 'number' && isNaN(Number(value))) {
          errors.push(`${field} must be a number`);
        } else if (rules.type === 'boolean' && typeof value !== 'boolean') {
          errors.push(`${field} must be a boolean`);
        } else if (rules.type === 'string' && typeof value !== 'string') {
          errors.push(`${field} must be a string`);
        }
      }
      
      // Enum validation
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
      
      // Minimum value validation
      if (rules.min !== undefined && value !== undefined && value !== null) {
        const numValue = Number(value);
        if (!isNaN(numValue) && numValue < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }
    
    next();
  };
};