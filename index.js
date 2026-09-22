import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {createClient} from '@supabase/supabase-js';
import {MailtrapClient} from 'mailtrap';
import dotenv from 'dotenv';
import crypto from 'crypto';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port =3000;
app.use(cookieParser());
const supalink = process.env.supalink;
const supakey = process.env.supakey;
const supabase = createClient(supalink,supakey);
const MAILTRAP = process.env.MAILTRAP;
const host = process.env.HOST || `http://localhost:${port}`;
const clientelle = new MailtrapClient({
  token: MAILTRAP,
});

const sender = {
  email: process.env.SENDER_EMAIL || 'sysco@giisclubs.org',
    name: 'Sysco Events',
};


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'views')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req,res) => {
    res.render('index')
})
app.get('/schedule', (req,res)=>{
    res.render('eventreg')
})
async function authcheck(req,res,next){
    const hash = req.cookies.hash;
    const username = req.cookies.username;
    if (!hash || !username) {
        return res.redirect('/login');
    }
    if (hash && username) {
        // Check if them users are authenticated or naht
        const {data, error} = await supabase.from('Events').select('*').eq('hash', hash);
        if (error) {
            return res.status(500).send("Error fetching the requested event");
        } else if (!data || data.length === 0) {
          return res.status(401).send("Invalid credentials");
        } else{
            next(null, data);
        }
    }
}
app.get('/dashboard', (req,res,next)=>{
    authcheck(req,res,(error, data)=>{
        if (error) return next(error);

        res.render('dashboard', {
            username:req.cookies.username,
            hash:req.cookies.hash,
            event_name:data[0].event_name,
        })
    })    
})
app.get('/qr', (req,res)=>{
    authcheck(req,res,(error, data)=>{
    if (error) return res.status(500).send('Error authenticating the requested event');
        res.render('qr', {
            username:req.cookies.username,
            hash:req.cookies.hash,
            event_name:data[0].event_name,
      supabaseUrl:supalink,
      supakey:supakey,
        })
    })
})
app.get('/login', (req,res)=>{
    res.render('login')
})
app.post('/schedule', async (req,res)=>{
    const {event_name, email, password} = req.body;
  if (!event_name || !email || !password) {
    return res.status(400).send('Event name, email, and password are required');
  }
    const username = email.split('@')[0] + Math.random().toString(36).substring(2, 4);
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    const {error} = await supabase.from('Events').insert([{event_name: event_name, email:email, hash, salt, username}]);
    
    if (error){
        console.error('Error inserting data:', error);
        res.status(500).send('Error creating event');
    } else{
        const recipients = [
            {
                email: email,
            }
        ];
        if (MAILTRAP) {
      try {
        await clientelle.send({
          from: sender,
            to: recipients,
            subject: `Your ${event_name} Login Details are Ready`,
            text: `Your event has been scheduled successfully. You can log in to your event dashboard using the following credentials:\n\nUsername: ${event_name}\nPassword: ${password}\n\nPlease keep this information secure.\n\nBest regards,\nSysco Events Team`,
            html: `
            <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${event_name} Successfully Created</title>
</head>
<body style="margin:0; padding:0; background-color:#000000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <tr>
            <td align="center" bgcolor="#031A54" style="padding:16px; border-radius:0 0 24px 24px;">
              <img src="${host}/resources/syscot.png" alt="Sysco logo" height="48" style="display:block; height:48px; border:0; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:32px 24px 12px; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">
              <h1 style="margin:0; font-size:26px; line-height:34px;">${event_name} Successfully Created</h1>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 24px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#ffffff;">
              Your event <strong>${event_name}</strong> has been created on the Sysco event suite. Use the details below to access your event dashboard. They are for the event organisers only and should be kept confidential. Sysco is not responsible for any misuse of these details.
            </td>
          </tr>

          <tr>
            <td style="padding:0 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#031A54" style="border-radius:12px;">
                <tr>
                  <td align="center" style="padding:28px 24px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#ffffff;">
                    Use this link to log in to your Sysco Dashboard
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px 24px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#4378FF" style="border-radius:8px;">
                          <a href="${host}/logind/${encodeURIComponent(username)}?password=${encodeURIComponent(password)}" target="_blank" style="display:inline-block; padding:14px 32px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none;">Login to Dashboard</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr><td height="1" bgcolor="#ffffff" style="height:1px; line-height:1px; font-size:1px; opacity:0.3;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:24px 24px 28px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:26px; color:#ffffff;">
                    Or use these details on <a href="${host}/login" target="_blank" style="color:#98c8ff;">Sysco Login</a><br>
                    <strong>Username:</strong> ${username}<br>
                    <strong>Password:</strong> ${password}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
            `,
            headers: {
                "Importance": "high",
                "X-Priority": "1",
                "X-MSMail-Priority": "High",
            },
        });
      } catch (error) {
        console.error('Mailtrap send failed:', error);
        return res.status(502).send('Event created, but the login email could not be sent');
      }
} else {
    console.error('MAILTRAP is not configured; skipping email.');
}
        res.redirect('login');
    }
    
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    try {
        const { data, error } = await supabase
            .from('Events')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !data) {
            console.error('Error fetching event:', error);
            return res.status(401).send('Invalid credentials');
        }

        const hash = data.hash;
        const salt = data.salt;
        const hashcheck = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

        if (hashcheck !== hash) {
            return res.status(401).send('Invalid credentials');
        }

        res.cookie('hash', hash, { httpOnly: true });
        res.cookie('username', username, { httpOnly: true });
        return res.redirect('/dashboard');
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).send('Error logging in');
    }
});
app.get('/logind/:id', (req,res)=>{
    const {id} = req.params;
  const {password} = req.query;
  const username = id;
  if (!username || typeof password !== 'string' || !password) {
    return res.status(400).send("Username and password are required");
  }
    supabase.from('Events').select('*').eq('username',username).single().then(({error, data })=>{
        if (error){
            console.error('Error fetching event:', error);
      return res.status(500).send("Error fetching the requested event");
        }
    if (!data) {
      return res.status(404).send("Event not found");
    }
        const hash = data.hash;
        const salt = data.salt;
        const hashcheck = crypto.pbkdf2Sync(password, salt, 1000,64, 'sha512').toString('hex');
        if (hashcheck !== hash){
            res.status(401).send("Invalid credentials");
        }else{
            res.cookie('hash',hash, {httpOnly:true});
            res.cookie('username',username, {httpOnly:true});
            res.redirect('/dashboard');
        }
    });
});
app.get('/email', (req,res)=>{
    authcheck(req,res,async (error, data)=>{
        if (error) return res.status(500).send("Error authenticating");
        const {data:datea, error:errora} = await supabase.from('Users').select('*').eq('username', req.cookies.username).single();
        console.log(datea);
        if (data) return res.render('email', { username:req.cookies.username, hash:req.cookies.hash, event_name:data[0].event_name, datea})
    })
})

if (process.env.VERCEL !== '1') {
    app.listen(port, () => {
        console.log('server is running on port ' + port);
        console.log('http://localhost:' + port);
    });
}