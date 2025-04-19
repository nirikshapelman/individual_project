//Login Functionality
document.getElementById('login-form').addEventListener('submit', function (e) {
    const email = document.getElementById('email').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (!email ||!username || !password ) {
        alert('Please enter all fields');
        e.preventDefault();
    }
});
