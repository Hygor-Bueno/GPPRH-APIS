
/**
 * Hygor Bueno
 *
 * @class User
 * @typedef {User}
 */
class User{
    constructor({ user_id, name, email, roles, permissions }){
        this.user_id = user_id;
        this.name = name;
        this.email = email;
        this.roles = roles.split(','); // Convert comma-separated string to array,
        this.permissions = permissions.split(','); // Convert comma-separated string to array
    }
}

module.exports = { User };