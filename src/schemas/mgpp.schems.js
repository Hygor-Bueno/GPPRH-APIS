
const awards = {
    category_award: { type: 'text' },
    total_value_award: { type: 'number', require: true },
}

const percentage = {
    costcenter_code: { type: 'text' },
    branch_code: { type: 'text' },
    value_percentage_sale: { type: 'number' },
    value_percentage_loss: { type: 'number' },
    value_sector_percentage: { type: 'number' }
}

const inventory = {
    branch_code: { type: 'text' },
    costcenter_code: { type: 'text' },
    expected_quantity: { type: 'number' },
    status_inventory: { type: 'number' },
    quantity_performed: { type: 'number' },
    has_audit: { type: 'number' },
}

const inventory_configs = {
    id_inventory_config: { type: 'number' },
    branch_code: { type: 'text' },
    costcenter_code: { type: 'text' },
    quantity_for_month: { type: 'number' },
}

module.exports = {
    awards,
    inventory,
    inventory_configs,
    percentage
}