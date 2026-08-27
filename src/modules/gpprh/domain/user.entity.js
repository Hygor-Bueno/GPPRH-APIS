
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
        if(roles) this.roles = Array.isArray(roles) ? roles : roles.split(',');
        if(permissions) this.permissions = Array.isArray(permissions) ? permissions : permissions.split(',');
        if(roles) {
            const r = Array.isArray(roles) ? roles : roles.split(',');
            if(r.includes('CANDIDATE')) this.candidate = true;
        }
    }
    setCandidate(isCandidate){
        this.candidate = isCandidate;
    }
}

module.exports = { User };