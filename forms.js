// Form definitions. The UI and the AI extraction are both generated from these,
// so adding a new form (e.g. a receipt) means adding one entry here.

export const FORMS = {
  placement: {
    title: 'Tenant Placement Agreement',
    description: 'Agreement between a landlord and a real estate agent/agency for placing a tenant in a property.',
    sections: [
      {
        title: 'Agreement',
        fields: [
          { key: 'agreement_date', label: 'Agreement date', type: 'date', hint: 'Date the agreement is made. "today" means the current date.' },
          { key: 'agreement_number', label: 'Agreement / reference no.', type: 'text' },
        ],
      },
      {
        title: 'Landlord',
        fields: [
          { key: 'landlord_name', label: 'Landlord name', type: 'text' },
          { key: 'landlord_phone', label: 'Landlord phone', type: 'tel', hint: 'Digits only, keep a leading + if spoken.' },
          { key: 'landlord_email', label: 'Landlord email', type: 'email', hint: 'Convert spoken form like "john at gmail dot com" to john@gmail.com.' },
        ],
      },
      {
        title: 'Tenant',
        fields: [
          { key: 'tenant_name', label: 'Tenant name', type: 'text' },
          { key: 'tenant_phone', label: 'Tenant phone', type: 'tel', hint: 'Digits only, keep a leading + if spoken.' },
          { key: 'tenant_email', label: 'Tenant email', type: 'email', hint: 'Convert spoken form to a real email address.' },
        ],
      },
      {
        title: 'Property',
        fields: [
          { key: 'property_address', label: 'Property address', type: 'text', wide: true },
          { key: 'unit_number', label: 'Unit / apartment no.', type: 'text' },
          { key: 'property_type', label: 'Property type', type: 'select', options: ['Apartment', 'Villa', 'Townhouse', 'Studio', 'Office', 'Retail', 'Warehouse', 'Land', 'Other'] },
          { key: 'bedrooms', label: 'Bedrooms', type: 'number', hint: 'Studio = 0.' },
        ],
      },
      {
        title: 'Lease terms',
        fields: [
          { key: 'lease_start', label: 'Lease start date', type: 'date' },
          { key: 'lease_term_months', label: 'Lease term (months)', type: 'number', hint: '"one year" = 12.' },
          { key: 'monthly_rent', label: 'Monthly rent', type: 'number', hint: 'If an annual rent is given, divide by 12.' },
          { key: 'currency', label: 'Currency', type: 'select', options: ['USD', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP', 'JOD', 'EUR', 'GBP'], hint: 'ISO code. dirhams = AED, riyals = SAR unless Qatari/Omani is said.' },
          { key: 'payment_frequency', label: 'Rent payment', type: 'select', options: ['Monthly', 'Quarterly', 'Semi-annually', 'Annually'], hint: '"4 cheques" = Quarterly, "2 cheques" = Semi-annually, "1 cheque" = Annually.' },
          { key: 'security_deposit', label: 'Security deposit', type: 'number' },
        ],
      },
      {
        title: 'Placement fee',
        fields: [
          { key: 'placement_fee', label: 'Fee amount', type: 'number', hint: 'The number only; its unit goes in placement_fee_type.' },
          { key: 'placement_fee_type', label: 'Fee type', type: 'select', options: ['Fixed amount', 'Percent of annual rent', 'Months of rent'] },
          { key: 'fee_paid_by', label: 'Fee paid by', type: 'select', options: ['Landlord', 'Tenant', 'Split'] },
        ],
      },
      {
        title: 'Agent',
        fields: [
          { key: 'agent_name', label: 'Agent name', type: 'text' },
          { key: 'agency_name', label: 'Agency', type: 'text' },
        ],
      },
      {
        title: 'Other',
        fields: [
          { key: 'special_terms', label: 'Special terms / notes', type: 'textarea', wide: true, hint: 'Anything relevant that does not fit another field (pets, furnishing, maintenance, parking...). Write clean sentences.' },
        ],
      },
    ],
  },
};

export const fieldsOf = (form) => form.sections.flatMap((s) => s.fields);
