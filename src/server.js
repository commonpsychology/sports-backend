import express from 'express'

const app = express()

app.get('/', (req, res) => {
  res.send('Backend working 🚀')
})

app.listen(5000, () => {
  console.log('Server running on port 5000')
})