
/**
 * Hygor Bueno
 *
 * @class User
 * @typedef {User}
 */
class User{
    candidate = false;
    constructor({ user_id, name, email, roles, permissions }){
        this.user_id = user_id;
        this.name = name;
        this.email = email;
        if(roles) this.roles = roles.split(','); // Convert comma-separated string to array,
        if(permissions) this.permissions = permissions.split(','); // Convert comma-separated string to array
        if(roles && roles.includes('CANDIDATE')) this.candidate = true;
    }
    setCandidate(isCandidate){
        this.candidate = isCandidate;
    }
}

module.exports = { User };