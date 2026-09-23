import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import path from 'path';
import {fileURLToPath, pathToFileURL} from 'url';
import {readFile} from 'fs/promises';
import {createClient} from '@supabase/supabase-js';
import {MailtrapClient} from 'mailtrap';
import QRCode from 'qrcode';
import ejs from 'ejs';
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

  function getSessions(event) {
    const eventInfo = event.event_info;
    if (!eventInfo) return {};

    if (typeof eventInfo === 'string') {
      try {
        return JSON.parse(eventInfo) || {};
      } catch (error) {
        return {};
      }
    }

    return typeof eventInfo === 'object' && !Array.isArray(eventInfo) ? eventInfo : {};
  }

  function sessionEntries(event) {
    return Object.entries(getSessions(event))
      .map(([name, id]) => ({name, id: Number(id)}))
      .filter(({name, id}) => name.trim() && Number.isSafeInteger(id) && id > 0);
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
app.get('/eventpage', (req,res)=>{
  authcheck(req,res,(error, data)=>{
    if (error) return res.status(500).send('Error authenticating the requested event');
    const event = data[0];
    res.render('editevent', {
      username:req.cookies.username,
      event_name:event.event_name,
      sessions:sessionEntries(event),
    });
  });
});


async function generatesessions(username, sessions){
  const targetSessionIds = new Set(
    Object.values(sessions || {})
      .map(id => Number(id))
      .filter(id => Number.isSafeInteger(id) && id > 0)
  );

  const {data: users, error} = await supabase.from('Users').select('*').eq('username', username);
  if (error) {
    console.error('Error fetching users for session generation:', error);
    return;
  }
  if (!users || users.length === 0) return;

  for (const user of users){
    const {data: existingSesh, error: eErr} = await supabase.from('Sessions').select('*').eq('uuid', user.uuid);
    if (eErr){
      console.error('Error fetching existing sessions for user', user.uuid, eErr);
      continue;
    }

    const existingSessionIds = new Set((existingSesh || []).map(s => Number(s.sessionid)));

    const sessionsToDelete = (existingSesh || [])
      .filter(s => !targetSessionIds.has(Number(s.sessionid)))
      .map(s => s.sessionid);

    if (sessionsToDelete.length > 0) {
      const {error: delErr} = await supabase
        .from('Sessions')
        .delete()
        .eq('uuid', user.uuid)
        .in('sessionid', sessionsToDelete);

      if (delErr) console.error('Error deleting stale sessions for user', user.uuid, delErr);
    }

    const sessionsToInsert = Array.from(targetSessionIds)
      .filter(id => !existingSessionIds.has(id))
      .map(id => ({uuid: user.uuid, sessionid: id}));

    if (sessionsToInsert.length > 0) {
      const {error: insErr} = await supabase.from('Sessions').insert(sessionsToInsert);
      if (insErr) console.error('Error inserting new sessions for user', user.uuid, insErr);
    }
  }
}
app.post('/editevent', async (req,res)=>{
  authcheck(req,res,async (error, data)=>{
    if (error) return res.status(500).send('Error authenticating the requested event');
    const username = req.cookies.username;
    const event_name = req.body.event_name;
    const {data: currentEvent, error: fetchErr} = await supabase.from('Events').select('*').eq('username', username).single();
    if (fetchErr || !currentEvent) return res.status(500).send('Error fetching event data');

    const eventInfo = getSessions(currentEvent);

    let sessionIds = req.body.session_id;
    let sessionNames = req.body.session_name;

    if (typeof sessionIds === 'undefined') sessionIds = [];
    else if (!Array.isArray(sessionIds)) sessionIds = [sessionIds];

    if (typeof sessionNames === 'undefined') sessionNames = [];
    else if (!Array.isArray(sessionNames)) sessionNames = [sessionNames];

    let maxId = 0;
    for (const val of Object.values(eventInfo)) {
      const parsed = Number(val);
      if (Number.isSafeInteger(parsed) && parsed > maxId) {
        maxId = parsed;
      }
    }

    const newEventInfo = {};
    for (let i = 0; i < sessionNames.length; i++) {
      const name = typeof sessionNames[i] === 'string' ? sessionNames[i].trim() : '';
      if (!name) continue;

      let idStr = typeof sessionIds[i] === 'string' ? sessionIds[i].trim() : '';
      let idNum = Number(idStr);

      if (idStr && Number.isSafeInteger(idNum) && idNum > 0) {
        newEventInfo[name] = String(idNum);
        if (idNum > maxId) maxId = idNum;
      } else {
        maxId += 1;
        newEventInfo[name] = String(maxId);
      }
    }

    const {error:updatingerr} = await supabase
      .from('Events')
      .update({
        event_name,
        event_info: JSON.stringify(newEventInfo)
      })
      .eq('username', username);

    if(updatingerr) return res.status(500).send('Error updating event info');
    await generatesessions(username, newEventInfo);
    res.redirect('/eventpage');
  });
});


app.get('/qr', (req,res)=>{
    authcheck(req,res,(error, data)=>{
    if (error) return res.status(500).send('Error authenticating the requested event');
        res.render('qr', {
            username:req.cookies.username,
            hash:req.cookies.hash,
            event_name:data[0].event_name,
            sessions:sessionEntries(data[0]),
            supabaseUrl:supalink,
            supakey:supakey,
        })
    })
})
  app.post('/qr/checkin', (req, res)=>{
    authcheck(req, res, async (error)=>{
      if (error) return res.status(500).json({error: 'Error authenticating the requested event'});

      const identity = typeof req.body.identity === 'string' ? req.body.identity.trim() : '';
      const sessionId = Number(req.body.sessionId);
      const username = req.cookies.username;

      if (!identity || !Number.isSafeInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({error: 'Invalid participant or session'});
      }

      const {data: participant, error: participantError} = await supabase
        .from('Users')
        .select('*')
        .eq('uuid', identity)
        .eq('username', username)
        .single();

      if (participantError || !participant) {
        return res.status(404).json({error: 'Participant is not registered for this event'});
      }

      const {data: session, error: sessionError} = await supabase
        .from('Sessions')
        .select('*')
        .eq('uuid', identity)
        .eq('sessionid', sessionId)
        .single();

      if (sessionError || !session) {
        return res.status(404).json({error: 'Participant is not registered for this session'});
      }

      if (session.present) {
        return res.status(409).json({
          status: 'already_checked_in',
          participant,
          session,
        });
      }

      const {data: updatedSession, error: updateError} = await supabase
        .from('Sessions')
        .update({present: true})
        .eq('uuid', identity)
        .eq('sessionid', sessionId)
        .eq('present', false)
        .select()
        .single();

      if (updateError || !updatedSession) {
        return res.status(500).json({error: 'Unable to check in participant'});
      }

      return res.json({status: 'checked_in', participant, session: updatedSession});
    });
  });
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
    const event_info = JSON.stringify({});
    const {error} = await supabase.from('Events').insert([{event_name: event_name, email:email, hash, salt, username, event_info}]);
    
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
app.get('/viewparticipant', (req,res)=>{
    authcheck(req,res,async (error, data)=>{
        if (error) return res.status(500).send("Error authenticating");
        const {data:datea, error:errora} = await supabase.from('Users').select('*').eq('username', req.cookies.username);
        console.log(datea);
        if (data) return res.render('viewparticipant', { username:req.cookies.username, event_name:data[0].event_name, datea})
    })
})
app.get('/sendemail/:id', (req,res)=>{
  authcheck(req,res,async (error, data)=>{
    if (error) return res.status(500).send("Error authenticating");
    const {id} = req.params;
    const {data:participant, error:err} =await supabase.from('Users').select('*').eq('uuid',id).single();
    if (err) return res.status(500).send("Error fetching participant data");
    const event_name = data[0].event_name;
    const orgemail = data[0].email;
    const u_name = participant.name;
    const u_email = participant.email;
    const additional_info = participant.extrainfo || "None";
    const qr_code = await QRCode.toBuffer(`sysco://${participant.uuid}`, {type: 'png'});
    
    const recipients = [{
      email: participant.email,
    }]
    const cc = participant.email.toLowerCase() === orgemail.toLowerCase()
      ? []
      : [{email: orgemail}];
    if (MAILTRAP) {
      try {
        await clientelle.send({
          from: sender,
            to: recipients,
            cc: cc,
            subject: `Your ${event_name} Ticket`,
            attachments: [{
              filename: 'participant-qr.png',
              content_id: 'participant-qr.png',
              disposition: 'inline',
              content: qr_code,
            }],
            text: `Welcome to ${event_name}, ${u_name}.

Use the QR code in this email to access the event page. This QR code admits one person only.

Your Email: ${u_email}
Your Name: ${u_name}
Additional information: ${additional_info}

For help, contact the event organiser at ${orgemail}.

${event_name} is powered by the Sysco Event Suite.`,
            html: `
            <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to {{event_name}}</title>
</head>
<body style="margin:0; padding:0; background-color:#000000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <tr>
            <td align="center" bgcolor="#031A54" style="padding:16px; border-radius:0 0 24px 24px;">
              <img src="${host}/resources/syscot.png" alt="Sysco" height="48" style="display:block; height:48px; border:0; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:32px 24px 12px; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">
              <h1 style="margin:0; font-size:26px; line-height:34px;">Welcome to ${event_name}, ${u_name}</h1>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 24px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#ffffff;">
              You have been invited to ${event_name} via the Sysco event suite. Use the QR code below the access the event page. This QR code admits one person only. Please do not share this QR code with anyone else. Neither Sysco nor the event organisers are responsible for any misuse of this QR code. If you have any issues with the QR code, please contact the event organisers directly.
              <br>
              <br>
              You may contact the event organiser at <a href="mailto:${orgemail}">${orgemail}</a>
              <br>
            </td>
          </tr>

          <tr>
            <td style="padding:0 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#031A54" style="border-radius:12px;">
                <tr>
                  <td align="center" style="padding:28px 24px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#ffffff;">
                    Use this QR code on the day of the event
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px 24px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#4378FF" style="border-radius:8px;">
                          <img src="cid:participant-qr.png" alt="QR Code" style="display:block; height:200px;width:200px;padding:10px; border:0; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">
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
                    Your details for the event are as follows:<br>
                    <strong>Your Email:</strong> ${u_email}<br>
                    <strong>Your Name:</strong> ${u_name}<br>
                    <strong>Additional information:</strong> ${additional_info}<br>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 24px 24px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; color:#ffffff; text-align:center;">
              ${event_name} is powered by the Sysco Event Suite
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
        return res.status(502).send('Email could not be sent');
      }
    }
    res.redirect('/viewparticipant');
  });
})
app.get('/remove/:id', (req,res)=>{
  authcheck(req,res,async (error, data)=>{
    if (error) return res.status(500).send("Error authenticating");
    const {id} = req.params;
    const {error:errora} = await supabase.from('Users').delete().eq('uuid',id);
    const {error:errod} = await supabase.from('Sessions').delete().eq('uuid',id);
    if (errod) return res.status(500).send("Error Deleting Participant Sessions")
    if (errora) return res.status(500).send("Error deleting the participant");
    res.redirect('/viewparticipant', {alert: "Participant Deleted Successfully"});
  });
})
app.get('/edit/:id', (req,res)=>{
  authcheck(req,res, async (error,data)=>{
    if (error) return res.status(500).send("Error Authenticating");
    const {id} = req.params;
    const {data:particpent, error:err} = await supabase.from('Users').select("*").eq('uuid',id).single();
    if (err) return res.status(500).send("Error fetching participant data ");
    res.render('editparticipant', {username:req.cookies.username, event_name:data[0].event_name, participant:particpent});
  })
})
app.post('/edit/:id', (req,res)=>{
  authcheck(req,res, async (error,data)=>{
    if (error) return res.status(500).send("Error while Authenticating");
    const {id} = req.params;
    const {name,email,extrainfo}=req.body;
    const {error:err} = await supabase.from('Users').update({name,email,extrainfo}).eq('uuid',id);
    if (err) return res.status(500).send("Error while updating data");
    res.redirect('/viewparticipant');
  })
})

export default app;

if (process.env.VERCEL !== '1') {
    app.listen(port, () => {
        console.log('server is running on port ' + port);
        console.log('http://localhost:' + port);
    });
}